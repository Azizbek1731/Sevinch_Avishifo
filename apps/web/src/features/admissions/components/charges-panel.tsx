'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BedDouble, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import { formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { cn } from '@/lib/utils';
import { Link, useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AddChargeDialog } from './add-charge-dialog';
import { EmptyState } from '@/components/empty-state';
import { useApiErrorToast } from '@/features/services/hooks';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissions } from '@/hooks/use-permissions';
import { admissionsApi, chargeTitle, chargesApi, type ChargeRow } from '../api';

/**
 * What the patient owes, with a tick beside each line.
 *
 * This is the screen the desk actually works in: services accumulate as they
 * are delivered — a consultation, a marked-off day on the ward — and the
 * patient pays for all of them or some of them, whenever they choose to. The
 * total under the button is of the TICKED lines, not of everything owed, so
 * what is about to be charged is never a surprise.
 */
export function ChargesPanel({
  patientId,
  admissionId,
  allowAdd = true,
}: {
  patientId: string;
  admissionId?: string;
  allowAdd?: boolean;
}) {
  const t = useTranslations('charges');
  const tc = useTranslations('common');
  const ta = useTranslations('admissions');
  const locale = useLocale();
  const can = usePermissions();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();

  const canWrite = can('charges.write');
  const canBill = canWrite && can('invoices.write');
  const [addOpen, setAddOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['charges', patientId, admissionId, branchId],
    queryFn: async () => (await chargesApi.list(patientId, 'PENDING', admissionId)).data,
    refetchInterval: admissionId ? 10_000 : false,
  });
  const finance = useQuery({
    queryKey: ['admission-discharge-check', admissionId],
    queryFn: async () => (await admissionsApi.dischargeCheck(admissionId!)).data,
    enabled: Boolean(admissionId) && can('admissions.read'),
    refetchInterval: 10_000,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['charges', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['patients'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['admission-discharge-check', admissionId] });
  };

  const bill = useMutation({
    mutationFn: (ids: string[]) => chargesApi.invoice(ids),
    onSuccess: (res) => {
      setSelected(new Set());
      invalidate();
      toast.success(t('billed', { number: res.data.number }));
      // Reception hands the issued invoice to the cashier.
      router.push(`/invoices/${res.data.id}`);
    },
    onError: errorToast,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => chargesApi.cancel(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('cancelled'));
    },
    onError: errorToast,
  });

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = items.filter((c) => selected.has(c.id)).map((c) => c.id);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const selectedTotal = items
    .filter((c) => selected.has(c.id))
    .reduce((acc, c) => acc + toTiyin(c.lineTotal), 0n);

  if (query.isLoading) return <Skeleton className="h-48 w-full" />;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('loadError')}
      </p>
    );

  return (
    <div className="space-y-3">
      {admissionId && can('admissions.read') ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{ta('directBilling.awaitingPayment')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{ta('directBilling.hint')}</p>
              </div>
              {finance.data ? (
                <strong className="tabular-nums">
                  {formatUZS(finance.data.accountDue ?? finance.data.stayDebt)}
                </strong>
              ) : null}
            </div>
            {finance.isLoading ? (
              <Skeleton className="h-12" />
            ) : finance.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {t('loadError')}
              </p>
            ) : finance.data?.stayInvoices.length ? (
              <ul className="divide-y">
                {finance.data.stayInvoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div>
                      {can('invoices.read') ? (
                        <Link
                          className="font-medium text-primary underline"
                          href={`/invoices/${invoice.id}`}
                        >
                          {invoice.number}
                        </Link>
                      ) : (
                        <span>{invoice.number}</span>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {ta('directBilling.paid')}: {formatUZS(invoice.paidTotal)}
                      </p>
                    </div>
                    <span className="font-medium tabular-nums">{formatUZS(invoice.due)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{ta('directBilling.noPending')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {canWrite && allowAdd ? (
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('add.title')}
        </Button>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="flex items-center gap-3">
              {canBill && items.length > 0 ? (
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) =>
                    setSelected(v === true ? new Set(items.map((c) => c.id)) : new Set())
                  }
                  aria-label={t('selectAll')}
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold">{t('title')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('owedTotal')}: {formatUZS(query.data?.pendingTotal ?? '0')}
                </p>
              </div>
            </div>
            {canBill && items.length > 0 ? (
              <Button
                disabled={selectedIds.length === 0 || bill.isPending}
                onClick={() => bill.mutate(selectedIds)}
              >
                <Receipt className="mr-2 h-4 w-4" />
                {selectedIds.length === 0
                  ? t('selectToBill')
                  : t('billSelected', {
                      count: selectedIds.length,
                      amount: formatUZS(fromTiyin(selectedTotal)),
                    })}
              </Button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Wallet}
                title={t('empty.title')}
                description={t('empty.description')}
              />
            </div>
          ) : null}
          <ul className="divide-y">
            {items.map((c: ChargeRow) => {
              const on = selected.has(c.id);
              return (
                <li
                  key={c.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 transition-colors',
                    on && 'bg-primary/[0.04]',
                  )}
                >
                  {canBill ? <Checkbox checked={on} onCheckedChange={() => toggle(c.id)} /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {chargeTitle(c.title, locale)}
                      {c.admissionId ? (
                        <Badge variant="outline" className="shrink-0 gap-1">
                          <BedDouble className="h-3 w-3" />
                          {t('fromWard')}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.date}
                      {c.quantity > 1 ? ` · ×${c.quantity}` : ''}
                      {c.surgeryId ? (
                        <Link
                          href={`/surgeries/${c.surgeryId}`}
                          className="ml-2 text-primary underline"
                        >
                          {t('openSurgery')}
                        </Link>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">
                    {formatUZS(c.lineTotal)}
                  </span>
                  {canWrite && !c.surgeryId ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-destructive"
                      disabled={cancel.isPending}
                      onClick={() => setCancelId(c.id)}
                      aria-label={t('cancel')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
      <AddChargeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        patientId={patientId}
        admissionId={admissionId}
      />
      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelId(null);
        }}
        title={t('cancel')}
        description={t('cancelConfirm')}
        confirmLabel={t('cancel')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={() => {
          if (cancelId) cancel.mutate(cancelId);
          setCancelId(null);
        }}
      />
    </div>
  );
}
