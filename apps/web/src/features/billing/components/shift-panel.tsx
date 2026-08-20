'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Lock,
  LockOpen,
  Printer,
  Wallet,
} from 'lucide-react';
import {
  closeShiftSchema,
  formatUZS,
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
import { Separator } from '@/components/ui/separator';
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

  const { data: shift, isLoading } = useQuery({
    queryKey: ['shifts', 'current', activeBranchId],
    queryFn: async () => (await billingApi.currentShift()).data,
  });

  const openForm = useForm<OpenShiftInput>({
    resolver: zodResolver(openShiftSchema),
    defaultValues: { openingCash: '0' },
  });

  const closeForm = useForm<CloseShiftInput>({
    resolver: zodResolver(closeShiftSchema),
    defaultValues: { actualCash: '', note: '' },
  });

  const openMutation = useMutation({
    mutationFn: (values: OpenShiftInput) => billingApi.openShift(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setOpenDlg(false);
      toast.success(t('shift.openSuccess'));
    },
    onError: errorToast,
  });

  const closeMutation = useMutation({
    mutationFn: (values: CloseShiftInput) => billingApi.closeShift(values),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setCloseDlg(false);
      setReport(res.data);
      toast.success(t('shift.closeSuccess'));
    },
    onError: errorToast,
  });

  const canManage = can('shifts.manage');

  if (isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  return (
    <>
      {shift ? (
        <div className="space-y-3">
          {/* Shift status strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/5 px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/15">
                <LockOpen className="h-4 w-4 text-success" />
              </div>
              <div className="text-sm">
                <span className="font-semibold">{t('shift.openBadge')}</span>
                <span className="ml-2 text-muted-foreground">
                  {t('shift.openedAt')}: {formatTz(shift.openedAt)}
                </span>
              </div>
            </div>
            {canManage ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  closeForm.reset({ actualCash: '', note: '' });
                  setCloseDlg(true);
                }}
              >
                <Lock className="mr-1 h-4 w-4" />
                {t('shift.close')}
              </Button>
            ) : null}
          </div>

          {/* Two registers: cash drawer vs non-cash transfers */}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Naqd kassa */}
            <Card className="border-emerald-500/30 bg-emerald-500/[0.04]">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <Banknote className="h-4 w-4" />
                  {t('registers.cash')}
                </div>
                <div>
                  <p className="text-3xl font-bold tabular-nums">
                    {formatUZS(shift.expectedCashSoFar)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('registers.inDrawer')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t pt-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('shift.openingCash')}</p>
                    <p className="font-medium tabular-nums">
                      {formatUZS(shift.openingCash, { withCurrency: false })}
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowDownLeft className="h-3 w-3 text-emerald-600" />
                      {t('shift.cashIn')}
                    </p>
                    <p className="font-medium tabular-nums text-emerald-600">
                      {formatUZS(shift.cashIn, { withCurrency: false })}
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpRight className="h-3 w-3 text-destructive" />
                      {t('shift.cashOut')}
                    </p>
                    <p className="font-medium tabular-nums text-destructive">
                      {formatUZS(shift.cashOut, { withCurrency: false })}
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Wallet className="h-3 w-3 text-destructive" />
                      {t('shift.expenseOut')}
                    </p>
                    <p className="font-medium tabular-nums text-destructive">
                      {formatUZS(shift.expenseOut, { withCurrency: false })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* O'tkazma kassa */}
            <Card className="border-primary/30 bg-primary/[0.04]">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <CreditCard className="h-4 w-4" />
                  {t('registers.transfer')}
                </div>
                <div>
                  <p className="text-3xl font-bold tabular-nums">
                    {formatUZS(shift.transferTotal)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('registers.received')}</p>
                </div>
                {shift.transferByMethod.length > 0 ? (
                  <div className="space-y-1 border-t pt-2 text-sm">
                    {shift.transferByMethod.map((row) => (
                      <div key={row.method} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">
                          {tb(`methods.${row.method}`)}
                          <span className="ml-1 text-xs">({row.count})</span>
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatUZS(row.amount, { withCurrency: false })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="border-t pt-2 text-sm text-muted-foreground">
                    {t('registers.noTransfer')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/15">
                <Wallet className="h-5 w-5 text-warning-foreground dark:text-warning" />
              </div>
              <div>
                <p className="font-semibold">{t('shift.closedTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('shift.closedDesc')}</p>
              </div>
            </div>
            {canManage ? (
              <Button
                onClick={() => {
                  openForm.reset({ openingCash: '0' });
                  setOpenDlg(true);
                }}
              >
                <LockOpen className="mr-1 h-4 w-4" />
                {t('shift.open')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Open shift dialog */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('shift.openTitle')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={openForm.handleSubmit((v) => openMutation.mutate(v))}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="opening-cash">{t('shift.openingCash')}</Label>
              <Input
                id="opening-cash"
                inputMode="decimal"
                autoComplete="off"
                {...openForm.register('openingCash', { setValueAs: sanitizeMoney })}
              />
              {openForm.formState.errors.openingCash ? (
                <p className="text-sm text-destructive">{tb('form.invalidAmount')}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="submit" className="w-full" disabled={openMutation.isPending}>
                {t('shift.open')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Close shift dialog */}
      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('shift.closeTitle')}</DialogTitle>
            {shift ? (
              <DialogDescription>
                {t('shift.expected')}: {formatUZS(shift.expectedCashSoFar)}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <form
            onSubmit={closeForm.handleSubmit((v) => closeMutation.mutate(v))}
            className="space-y-4"
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="actual-cash">{t('shift.actualCash')}</Label>
              <Input
                id="actual-cash"
                inputMode="decimal"
                autoComplete="off"
                className="text-lg font-semibold"
                {...closeForm.register('actualCash', { setValueAs: sanitizeMoney })}
              />
              {closeForm.formState.errors.actualCash ? (
                <p className="text-sm text-destructive">{tb('form.invalidAmount')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="close-note">{t('shift.note')}</Label>
              <Input id="close-note" autoComplete="off" {...closeForm.register('note')} />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                className="w-full"
                disabled={closeMutation.isPending}
              >
                {t('shift.close')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* X/Z report dialog */}
      <Dialog open={report !== null} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('report.title')}</DialogTitle>
          </DialogHeader>
          {report ? (
            <div className="print-area space-y-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('shift.openedAt')}</span>
                  <span>{formatTz(report.shift.openedAt)}</span>
                </div>
                {report.shift.closedAt ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('report.closedAt')}</span>
                    <span>{formatTz(report.shift.closedAt)}</span>
                  </div>
                ) : null}
              </div>
              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('report.openingCash')}</span>
                  <span>{formatUZS(report.report.openingCash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('report.cashIn')}</span>
                  <span>{formatUZS(report.report.cashIn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('report.cashOut')}</span>
                  <span>{formatUZS(report.report.cashOut)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('report.expenseOut')}</span>
                  <span>{formatUZS(report.report.expenseOut)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t('report.expectedCash')}</span>
                  <span>{formatUZS(report.report.expectedCash)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t('report.actualCash')}</span>
                  <span>{formatUZS(report.report.actualCash)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>{t('report.difference')}</span>
                  <span
                    className={
                      report.report.difference.startsWith('-')
                        ? 'text-destructive'
                        : 'text-success'
                    }
                  >
                    {formatUZS(report.report.difference)}
                  </span>
                </div>
              </div>
              <Separator />
              <p className="text-sm font-semibold">{t('report.byMethod')}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('report.method')}</TableHead>
                    <TableHead className="text-right">{t('report.count')}</TableHead>
                    <TableHead className="text-right">{t('report.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.report.byMethod.map((row) => (
                    <TableRow key={row.method}>
                      <TableCell>{tb(`methods.${row.method}`)}</TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatUZS(row.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1 h-4 w-4" />
              {t('report.print')}
            </Button>
            <Button onClick={() => setReport(null)}>{t('report.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
