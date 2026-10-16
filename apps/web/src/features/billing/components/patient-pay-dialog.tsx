'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  fromTiyin,
  toTiyin,
  formatUZS,
  PaymentMethod,
  type PaymentPart,
  type PatientCheckoutInput,
} from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
import { localizedText } from '@/lib/localized';
import { ApiError } from '@/lib/api-client';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi, type PatientOutstanding } from '../api';
import { useApiErrorToast, useInvalidateBilling } from '../hooks';
import { inputTiyin, needsOpenShift } from '../payment-methods';
import { PaymentSplit, splitTotalTiyin } from './payment-split';

function hasUncertainCheckoutResult(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status === 408 ||
    error.status >= 500 ||
    (error.status >= 200 && error.status < 300)
  );
}

export function PatientPayDialog({
  patientId,
  onClose,
  onPaid,
}: {
  patientId: string;
  onClose: () => void;
  onPaid: (checkoutId: string) => void;
}) {
  const t = useTranslations('billing');
  const branchId = useAuthStore((state) => state.activeBranchId);
  const query = useQuery({
    queryKey: ['billing', 'patient-outstanding', branchId, patientId],
    queryFn: async () => (await billingApi.patientOutstanding(patientId)).data,
    refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        onInteractOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('checkout.title')}</DialogTitle>
          <DialogDescription>
            {query.data?.patient.fullName ?? t('checkout.description')}
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <div role="alert" className="space-y-3">
            <p>{t('pending.loadFailed')}</p>
            <Button onClick={() => void query.refetch()}>{t('pending.refresh')}</Button>
          </div>
        ) : query.data ? (
          <PatientPaymentForm
            data={query.data}
            onPaid={onPaid}
            setBusy={setBusy}
            refresh={() => query.refetch()}
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PatientPaymentForm({
  data,
  onPaid,
  setBusy,
  refresh,
}: {
  data: PatientOutstanding;
  onPaid: (checkoutId: string) => void;
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<unknown>;
}) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const errorToast = useApiErrorToast();
  const invalidate = useInvalidateBilling();
  const branchId = useAuthStore((state) => state.activeBranchId);
  const [selected, setSelected] = useState(
    () => new Set(data.invoices.slice(0, 100).map((invoice) => invoice.id)),
  );
  const [payments, setPayments] = useState<PaymentPart[]>([
    { method: PaymentMethod.CASH, amount: '0.00' },
  ]);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const submitting = useRef(false);
  const uncertainRequest = useRef<PatientCheckoutInput | null>(null);
  const [recoveryInput, setRecoveryInput] = useState<PatientCheckoutInput | null>(null);
  const shift = useQuery({
    queryKey: ['shifts', 'current', branchId],
    queryFn: async () => (await billingApi.currentShift()).data,
  });
  const chosen = data.invoices.filter((invoice) => selected.has(invoice.id));
  const total = fromTiyin(chosen.reduce((value, invoice) => value + toTiyin(invoice.due), 0n));
  const shiftBlocked = payments.some((part) => needsOpenShift(part.method)) && !shift.data?.open;
  const unbalanced =
    payments.length > 1 &&
    (splitTotalTiyin(payments) !== toTiyin(total) ||
      payments.some((part) => (inputTiyin(part.amount) ?? 0n) <= 0n));
  const mutation = useMutation({
    mutationFn: async (input: PatientCheckoutInput) => {
      try {
        return await billingApi.checkout(input);
      } catch (error) {
        // A lost response may follow a committed payment. Keep the same request
        // until its idempotency key returns the original receipt.
        if (hasUncertainCheckoutResult(error)) uncertainRequest.current = input;
        throw error;
      }
    },
    retry: (failureCount, error) => failureCount < 1 && hasUncertainCheckoutResult(error),
    retryDelay: 500,
    onSuccess: (response) => {
      uncertainRequest.current = null;
      setRecoveryInput(null);
      invalidate();
      toast.success(t('pay.success'));
      onPaid(response.data.checkoutId);
    },
    onError: (error) => {
      errorToast(error);
      if (uncertainRequest.current) setRecoveryInput(uncertainRequest.current);
      else void refresh();
    },
    onSettled: () => {
      submitting.current = false;
      setBusy(false);
    },
  });
  const submit = () => {
    if (submitting.current) return;
    if (recoveryInput) {
      submitting.current = true;
      setBusy(true);
      mutation.mutate(recoveryInput);
      return;
    }
    if (!chosen.length || shiftBlocked || unbalanced || toTiyin(total) <= 0n) return;
    const input = {
      patientId: data.patient.id,
      invoiceIds: chosen.map((invoice) => invoice.id).sort(),
      expectedTotal: total,
      payments: payments.length === 1 ? [{ ...payments[0]!, amount: total }] : payments,
    };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    submitting.current = true;
    setBusy(true);
    mutation.mutate({ ...input, idempotencyKey: request.current.key });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('checkout.description')}</p>
      {recoveryInput ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {t('checkout.recoveryHint')}
        </p>
      ) : null}
      {data.invoices.length > 100 ? (
        <p className="text-sm text-warning-foreground">{t('checkout.limit')}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <Checkbox
            checked={
              chosen.length === Math.min(data.invoices.length, 100) && chosen.length > 0
                ? true
                : chosen.length > 0
                  ? 'indeterminate'
                  : false
            }
            disabled={mutation.isPending || !!recoveryInput || !data.invoices.length}
            onCheckedChange={(value) =>
              setSelected(
                value === true
                  ? new Set(data.invoices.slice(0, 100).map((invoice) => invoice.id))
                  : new Set(),
              )
            }
          />
          {t('checkout.selectAll')}
        </label>
        <span className="text-sm text-muted-foreground">
          {t('checkout.selected', { count: chosen.length })}
        </span>
      </div>
      <div className="max-h-[36dvh] space-y-2 overflow-y-auto pr-1">
        {data.invoices.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">{t('checkout.empty')}</p>
        ) : null}
        {data.invoices.map((invoice) => (
          <div
            key={invoice.id}
            className={`flex items-start gap-3 rounded-lg border p-3 ${selected.has(invoice.id) ? 'border-primary/40 bg-primary/5' : ''}`}
          >
            <Checkbox
              className="mt-1"
              aria-label={t('checkout.selectInvoice', { number: invoice.number })}
              checked={selected.has(invoice.id)}
              disabled={
                mutation.isPending ||
                !!recoveryInput ||
                (!selected.has(invoice.id) && chosen.length >= 100)
              }
              onCheckedChange={(value) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (value === true) next.add(invoice.id);
                  else next.delete(invoice.id);
                  return next;
                })
              }
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap justify-between gap-2">
                <Link
                  href={`/invoices/${invoice.id}`}
                  target="_blank"
                  className="text-sm text-primary hover:underline"
                >
                  {invoice.number}
                </Link>
                <strong className="tabular-nums">{formatUZS(invoice.due)}</strong>
              </div>
              <ul className="mt-1 space-y-1 text-sm">
                {invoice.lines.map((line) => (
                  <li key={line.id}>
                    {localizedText(line.title, locale)}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                  </li>
                ))}
              </ul>
              {toTiyin(invoice.paidTotal) > 0n ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('checkout.previouslyPaid')}: {formatUZS(invoice.paidTotal)}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-muted p-4">
        <span>{t('checkout.total')}</span>
        <strong className="text-xl tabular-nums">
          {formatUZS(recoveryInput?.expectedTotal ?? total)}
        </strong>
      </div>
      <PaymentSplit
        total={total}
        value={payments}
        onChange={setPayments}
        cashBlocked={shiftBlocked}
        disabled={mutation.isPending || !!recoveryInput || !chosen.length}
      />
      <DialogFooter>
        <Button
          size="lg"
          className="w-full"
          onClick={submit}
          disabled={
            mutation.isPending ||
            (!recoveryInput &&
              (!chosen.length || unbalanced || shiftBlocked || toTiyin(total) <= 0n))
          }
        >
          {mutation.isPending
            ? t('pay.paying')
            : recoveryInput
              ? t('checkout.recoverReceipt')
              : t('checkout.payAndPrint')}
        </Button>
      </DialogFooter>
    </div>
  );
}
