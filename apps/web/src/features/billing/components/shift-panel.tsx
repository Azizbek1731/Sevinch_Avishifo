'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Lock, LockOpen, Printer, Wallet } from 'lucide-react';
import {
  closeShiftSchema,
  formatUZS,
  fromTiyin,
  openShiftSchema,
  type CloseShiftInput,
  type OpenShiftInput,
} from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { billingApi, sanitizeMoney, type CloseShiftResult } from '../api';
import { useApiErrorToast, usePermission } from '../hooks';
import { inputTiyin, CLINIC_PAYMENT_METHODS } from '../payment-methods';
import { AccountCards, ACCOUNT_ICONS } from './account-cards';
import { ShiftPaymentsCard } from './shift-payments-card';

const OPEN_FIELDS = { CASH: 'openingCash', CARD: 'openingCard', CLICK: 'openingClick' } as const;
const CLOSE_FIELDS = { CASH: 'actualCash', CARD: 'actualCard', CLICK: 'actualClick' } as const;
const OPEN_DEFAULTS = {
  openingCash: '0',
  openingCard: '0',
  openingClick: '0',
  openingTransfer: '0',
};
const CLOSE_DEFAULTS = { actualCash: '', actualCard: '', actualClick: '', note: '' };
const REPORT_METRICS = [
  'opening',
  'receipts',
  'deposits',
  'refunds',
  'expenses',
  'expected',
  'actual',
  'difference',
] as const;

/** One shared clinic shift, reconciled independently for cash, card and Click. */
export function ShiftPanel() {
  const t = useTranslations('cashier');
  const tb = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const can = usePermission();
  const queryClient = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const [openDlg, setOpenDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  const [report, setReport] = useState<CloseShiftResult | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shifts', 'current', activeBranchId],
    queryFn: async () => (await billingApi.currentShift()).data,
    refetchInterval: 30_000,
  });
  const shift = data?.open ? data : null;
  const openForm = useForm<OpenShiftInput>({
    resolver: zodResolver(openShiftSchema),
    defaultValues: OPEN_DEFAULTS,
  });
  const closeForm = useForm<CloseShiftInput>({
    resolver: zodResolver(closeShiftSchema),
    defaultValues: CLOSE_DEFAULTS,
  });
  const openMutation = useMutation({
    mutationFn: (values: OpenShiftInput) => billingApi.openShift(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setOpenDlg(false);
      toast.success(t('shift.openSuccess'));
    },
    onError: (err: unknown) => {
      errorToast(err);
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
  });
  const closeMutation = useMutation({
    mutationFn: (values: CloseShiftInput) => billingApi.closeShift(values),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      setCloseDlg(false);
      setReport(res.data);
      toast.success(t('shift.closeSuccess'));
    },
    onError: errorToast,
  });
  const canManage = can('shifts.manage');
  const actuals = closeForm.watch();
  const allocationRequired = shift?.requiresOpeningAllocation ?? false;
  const openingCard = inputTiyin(actuals.openingCard ?? '');
  const openingClick = inputTiyin(actuals.openingClick ?? '');
  const allocationReady =
    !allocationRequired ||
    (openingCard !== null &&
      openingClick !== null &&
      openingCard >= 0n &&
      openingClick >= 0n &&
      openingCard + openingClick === inputTiyin(shift?.openingTransfer ?? '0'));
  const allCounted = CLINIC_PAYMENT_METHODS.every((method) => {
    const value = inputTiyin(actuals[CLOSE_FIELDS[method]] ?? '');
    return value !== null && value >= 0n;
  });

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (isError)
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold">{t('shift.loadFailedTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('shift.loadFailedDesc')}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('shift.retry')}
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <>
      {shift ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/5 px-4 py-3">
            <div className="flex items-center gap-3">
              <LockOpen className="h-5 w-5 text-success" />
              <div>
                <p className="text-sm font-semibold">
                  {t('shift.openBadge')} · {t('shift.openedBy', { name: shift.cashier.fullName })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('shift.openedAt')}: {formatTz(shift.openedAt)}
                </p>
              </div>
            </div>
            {canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  closeForm.reset({
                    ...CLOSE_DEFAULTS,
                    ...(shift.requiresOpeningAllocation
                      ? { openingCard: '', openingClick: '' }
                      : {}),
                  });
                  setCloseDlg(true);
                }}
              >
                <Lock className="mr-2 h-4 w-4" />
                {t('shift.close')}
              </Button>
            ) : null}
          </div>
          {allocationRequired ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
              <div>
                <p className="font-semibold">
                  {tb('accounts.legacyTitle', {
                    amount: formatUZS(shift.unallocatedOpeningTransfer),
                  })}
                </p>
                <p className="mt-1 text-muted-foreground">{tb('accounts.legacyHint')}</p>
              </div>
            </div>
          ) : null}
          <AccountCards accounts={shift.accounts} />
          <ShiftPaymentsCard />
        </div>
      ) : (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <Wallet className="h-6 w-6 text-warning-foreground" />
              <div>
                <p className="font-semibold">{t('shift.closedTitle')}</p>
                <p className="text-sm text-muted-foreground">{tb('accounts.closedHint')}</p>
              </div>
            </div>
            {canManage ? (
              <Button
                onClick={() => {
                  openForm.reset(OPEN_DEFAULTS);
                  setOpenDlg(true);
                }}
              >
                <LockOpen className="mr-2 h-4 w-4" />
                {t('shift.open')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('shift.openTitle')}</DialogTitle>
            <DialogDescription>{tb('accounts.openHint')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={openForm.handleSubmit((values) => openMutation.mutate(values))}
            className="space-y-4"
            noValidate
          >
            {CLINIC_PAYMENT_METHODS.map((method) => {
              const field = OPEN_FIELDS[method];
              const Icon = ACCOUNT_ICONS[method];
              return (
                <div key={method} className="space-y-2 rounded-lg border p-3">
                  <Label htmlFor={field} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {tb(`accounts.${method}`)} · {tb('accounts.opening')}
                  </Label>
                  <Input
                    id={field}
                    inputMode="decimal"
                    autoComplete="off"
                    {...openForm.register(field, { setValueAs: sanitizeMoney })}
                  />
                  {openForm.formState.errors[field] ? (
                    <p className="text-sm text-destructive">{tb('form.invalidAmount')}</p>
                  ) : null}
                </div>
              );
            })}
            <DialogFooter>
              <Button type="submit" disabled={openMutation.isPending}>
                {t('shift.open')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('shift.closeTitle')}</DialogTitle>
            <DialogDescription>{tb('accounts.closeHint')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={closeForm.handleSubmit((values) => {
              if (allCounted && allocationReady && !closeMutation.isPending)
                closeMutation.mutate(values);
            })}
            className="space-y-4"
            noValidate
          >
            {allocationRequired ? (
              <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                <p className="text-sm font-semibold">
                  {tb('accounts.allocateTitle', {
                    amount: formatUZS(shift?.openingTransfer ?? '0'),
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{tb('accounts.allocateHint')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['CARD', 'CLICK'] as const).map((method) => (
                    <div key={method} className="space-y-2">
                      <Label htmlFor={`legacy-${method}`}>
                        {tb(`accounts.${method}`)} · {tb('accounts.opening')}
                      </Label>
                      <Input
                        id={`legacy-${method}`}
                        inputMode="decimal"
                        autoComplete="off"
                        {...closeForm.register(OPEN_FIELDS[method], { setValueAs: sanitizeMoney })}
                      />
                    </div>
                  ))}
                </div>
                {!allocationReady ? (
                  <p className="text-xs text-destructive">{tb('accounts.allocationMismatch')}</p>
                ) : null}
              </div>
            ) : null}
            {CLINIC_PAYMENT_METHODS.map((method) => {
              const field = CLOSE_FIELDS[method];
              const Icon = ACCOUNT_ICONS[method];
              const account = shift?.accounts.find((item) => item.method === method);
              const replacementOpening = method === 'CARD' ? openingCard : openingClick;
              const expected =
                allocationRequired && method !== 'CASH'
                  ? replacementOpening === null
                    ? null
                    : fromTiyin(
                        (inputTiyin(account?.expected ?? '0') ?? 0n) -
                          (inputTiyin(account?.opening ?? '0') ?? 0n) +
                          replacementOpening,
                      )
                  : (account?.expected ?? '0');
              return (
                <div key={method} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={field} className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {tb(`accounts.${method}`)}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {tb('accounts.expected')}: {expected === null ? '—' : formatUZS(expected)}
                    </span>
                  </div>
                  <Input
                    id={field}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={tb('accounts.actual')}
                    {...closeForm.register(field, { setValueAs: sanitizeMoney })}
                  />
                  {closeForm.formState.errors[field] ? (
                    <p className="text-sm text-destructive">{tb('form.invalidAmount')}</p>
                  ) : null}
                </div>
              );
            })}
            <div className="space-y-2">
              <Label htmlFor="close-note">{t('shift.note')}</Label>
              <Input id="close-note" {...closeForm.register('note')} />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                disabled={closeMutation.isPending || !allCounted || !allocationReady}
              >
                {t('shift.close')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={report !== null} onOpenChange={(open) => !open && setReport(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('report.title')}</DialogTitle>
            <DialogDescription>{tb('accounts.reportHint')}</DialogDescription>
          </DialogHeader>
          {report ? (
            <div className="print-area space-y-4">
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>
                  {t('shift.openedAt')}: {formatTz(report.shift.openedAt)}
                </span>
                {report.shift.closedAt ? (
                  <span>
                    {t('report.closedAt')}: {formatTz(report.shift.closedAt)}
                  </span>
                ) : null}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tb('accounts.metric')}</TableHead>
                    {report.report.accounts.map((account) => (
                      <TableHead key={account.method} className="text-right">
                        {tb(`accounts.${account.method}`)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {REPORT_METRICS.map((metric) => (
                    <TableRow
                      key={metric}
                      className={
                        metric === 'expected' || metric === 'difference'
                          ? 'bg-muted/40 font-semibold'
                          : ''
                      }
                    >
                      <TableCell>{tb(`accounts.${metric}`)}</TableCell>
                      {report.report.accounts.map((account) => (
                        <TableCell
                          key={account.method}
                          className={`text-right tabular-nums ${metric === 'difference' && account.difference !== null && account.difference !== '0.00' ? 'text-destructive font-semibold' : ''}`}
                        >
                          {account[metric] === null
                            ? '—'
                            : formatUZS(account[metric]!, { withCurrency: false })}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {report.shift.note ? (
                <p className="text-sm">
                  {t('shift.note')}: {report.shift.note}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              {t('report.print')}
            </Button>
            <Button onClick={() => setReport(null)}>{t('report.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
