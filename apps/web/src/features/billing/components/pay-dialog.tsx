'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  addPaymentSchema,
  formatUZS,
  PaymentMethod,
  type MoneyString,
  type PaymentPart,
  type AddPaymentsInput,
} from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/stores/auth-store';
import { inputTiyin, needsOpenShift } from '../payment-methods';
import { billingApi, sanitizeMoney } from '../api';
import { PaymentSplit, splitTotalTiyin } from './payment-split';
import { useApiErrorToast, useInvalidateBilling } from '../hooks';
import type { ReceiptPrintRequest } from '../receipt-print';

const payFormSchema = addPaymentSchema.pick({ amount: true });
type PayFormValues = { amount: MoneyString };

export interface PayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: { id: string; number: string; due: MoneyString; patientName?: string };
  /** Owned by the surrounding screen so closing this dialog cannot cancel printing. */
  onPaid: (request: ReceiptPrintRequest) => void;
}

export function PayDialog({ open, onOpenChange, invoice, onPaid }: PayDialogProps) {
  const t = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const invalidate = useInvalidateBilling();
  const router = useRouter();
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const shiftQuery = useQuery({
    queryKey: ['shifts', 'current', activeBranchId],
    queryFn: async () => (await billingApi.currentShift()).data,
    enabled: open,
  });

  // One idempotency key per dialog opening: retries of the same submission reuse it.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const submitting = useRef(false);
  const deliveredReceipts = useRef(new Set<string>());

  const form = useForm<PayFormValues>({
    resolver: zodResolver(payFormSchema),
    defaultValues: { amount: invoice.due },
  });

  /** How the amount above is made up. One entry is the ordinary case. */
  const [payments, setPayments] = useState<PaymentPart[]>([
    { method: PaymentMethod.CASH, amount: invoice.due },
  ]);

  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID());
      form.reset({ amount: invoice.due });
      setPayments([{ method: PaymentMethod.CASH, amount: invoice.due }]);
    }
  }, [open, invoice.id, invoice.due]);

  const mutation = useMutation({
    mutationFn: (request: { invoiceId: string; payment: AddPaymentsInput }) =>
      billingApi.addPayments(request.invoiceId, request.payment),
    onSuccess: (_response, request) => {
      invalidate();
      onOpenChange(false);
      if (!deliveredReceipts.current.has(request.payment.idempotencyKey)) {
        deliveredReceipts.current.add(request.payment.idempotencyKey);
        onPaid({ invoiceId: request.invoiceId, requestId: request.payment.idempotencyKey });
      }
      toast.success(t('pay.success'), {
        action: {
          label: t('pay.viewReceipt'),
          onClick: () => router.push(`/invoices/${request.invoiceId}/receipt`),
        },
      });
    },
    onError: errorToast,
    onSettled: () => {
      submitting.current = false;
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (amountInvalid || unbalanced || shiftBlocked || submitting.current) return;
    submitting.current = true;
    mutation.mutate({
      invoiceId: invoice.id,
      payment: {
        payments:
          payments.length === 1
            ? [{ ...payments[0]!, amount: values.amount }]
            : payments,
        idempotencyKey,
      },
    });
  });

  const amount = form.watch('amount');
  const amountTiyin = inputTiyin(amount);
  const amountInvalid =
    amountTiyin === null || amountTiyin <= 0n || amountTiyin > (inputTiyin(invoice.due) ?? 0n);
  const unbalanced =
    payments.length > 1 &&
    (payments.some((part) => (inputTiyin(part.amount) ?? 0n) <= 0n) ||
      splitTotalTiyin(payments) !== amountTiyin);
  const shiftBlocked =
    payments.some((part) => needsOpenShift(part.method)) && !shiftQuery.data?.open;

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pay.title', { number: invoice.number })}</DialogTitle>
          <DialogDescription>
            {invoice.patientName ? (
              <span className="mb-1 block font-medium text-foreground">{invoice.patientName}</span>
            ) : null}
            {t('pay.due')}: <span className="font-semibold">{formatUZS(invoice.due)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="pay-amount">{t('pay.amount')}</Label>
            <Input
              id="pay-amount"
              inputMode="decimal"
              autoComplete="off"
              className="text-lg font-semibold"
              disabled={mutation.isPending}
              {...form.register('amount', { setValueAs: sanitizeMoney })}
            />
            {form.formState.errors.amount ? (
              <p className="text-sm text-destructive">{t('form.invalidAmount')}</p>
            ) : null}
          </div>
          <PaymentSplit
            total={amount || '0'}
            value={payments}
            onChange={setPayments}
            cashBlocked={shiftBlocked}
            disabled={mutation.isPending}
          />
          {amountTiyin !== null && amountTiyin > (inputTiyin(invoice.due) ?? 0n) ? (
            <p className="text-sm text-destructive">{t('pay.exceedsDue')}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={mutation.isPending || unbalanced || amountInvalid || shiftBlocked}
            >
              {mutation.isPending ? t('pay.paying') : t('pay.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
