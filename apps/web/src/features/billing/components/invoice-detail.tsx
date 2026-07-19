'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Ban, BadgeCheck, Banknote, ReceiptText, Undo2 } from 'lucide-react';
import { compareMoney, formatUZS } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { useSocketEvent } from '@/hooks/use-socket';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { billingApi } from '../api';
import { useApiErrorToast, useInvalidateBilling, usePermission } from '../hooks';
import { PayDialog } from './pay-dialog';
import { RefundDialog } from './refund-dialog';

export function InvoiceDetailView({ id }: { id: string }) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const tc = useTranslations('common');
  const can = usePermission();
  const errorToast = useApiErrorToast();
  const invalidate = useInvalidateBilling();
  const queryClient = useQueryClient();

  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', id],
    queryFn: async () => (await billingApi.getInvoice(id)).data,
  });

  useSocketEvent('invoice.paid', (p) => {
    if (p.invoiceId === id) void queryClient.invalidateQueries({ queryKey: ['invoices', id] });
  });

  const issueMutation = useMutation({
    mutationFn: () => billingApi.issueInvoice(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('detail.issued'));
    },
    onError: errorToast,
  });

  const cancelMutation = useMutation({
    mutationFn: () => billingApi.cancelInvoice(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('detail.cancelled'));
    },
    onError: errorToast,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!data) {
    return <EmptyState icon={ReceiptText} title={tc('notFound')} />;
  }

  const inv = data;
  const canPay =
    (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') && can('payments.create');
  const canIssue = inv.status === 'DRAFT' && can('invoices.write');
  const canCancel =
    (inv.status === 'DRAFT' || inv.status === 'ISSUED') && can('invoices.cancel');
  const canRefund = compareMoney(inv.paidTotal, '0') > 0 && can('refunds.create');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/invoices">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {tc('back')}
          </Link>
        </Button>
      </div>

      <PageHeader
        title={t('detail.title', { number: inv.number })}
        description={`${inv.patient.fullName} · ${formatTz(inv.createdAt)}`}
      >
        <StatusBadge status={inv.status} label={t(`statuses.${inv.status}`)} />
        {canIssue ? (
          <Button onClick={() => issueMutation.mutate()} disabled={issueMutation.isPending}>
            <BadgeCheck className="mr-1 h-4 w-4" />
            {t('detail.issue')}
          </Button>
        ) : null}
        {canPay ? (
          <Button onClick={() => setPayOpen(true)}>
            <Banknote className="mr-1 h-4 w-4" />
            {t('detail.pay')}
          </Button>
        ) : null}
        {canRefund ? (
          <Button variant="outline" onClick={() => setRefundOpen(true)}>
            <Undo2 className="mr-1 h-4 w-4" />
            {t('detail.refund')}
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            <Ban className="mr-1 h-4 w-4" />
            {t('detail.cancel')}
          </Button>
        ) : null}
        {inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' ? (
          <Button asChild variant="outline">
            <Link href={`/invoices/${inv.id}/receipt`}>
              <ReceiptText className="mr-1 h-4 w-4" />
              {t('detail.receipt')}
            </Link>
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('detail.linesTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('form.service')}</TableHead>
                  <TableHead className="text-right">{t('form.qty')}</TableHead>
                  <TableHead className="text-right">{t('form.unitPrice')}</TableHead>
                  <TableHead className="text-right">{t('form.discount')}</TableHead>
                  <TableHead className="text-right">{t('form.lineTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{localizedText(l.title, locale) || '—'}</TableCell>
                    <TableCell className="text-right">{l.quantity}</TableCell>
                    <TableCell className="text-right">{formatUZS(l.unitPrice)}</TableCell>
                    <TableCell className="text-right">{formatUZS(l.discount)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatUZS(l.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.totalsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('detail.subtotal')}</span>
              <span>{formatUZS(inv.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('form.discount')}</span>
              <span>{formatUZS(inv.discountTotal)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>{tc('total')}</span>
              <span>{formatUZS(inv.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('cols.paid')}</span>
              <span className="text-success">{formatUZS(inv.paidTotal)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>{t('cols.due')}</span>
              <span className={inv.due !== '0.00' ? 'text-destructive' : undefined}>
                {formatUZS(inv.due)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.paymentsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {inv.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.noPayments')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tc('date')}</TableHead>
                    <TableHead>{t('pay.method')}</TableHead>
                    <TableHead>{tc('status')}</TableHead>
                    <TableHead className="text-right">{t('pay.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatTz(p.paidAt)}</TableCell>
                      <TableCell>{t(`methods.${p.method}`)}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatUZS(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.refundsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {inv.refunds.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.noRefunds')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tc('date')}</TableHead>
                    <TableHead>{t('pay.method')}</TableHead>
                    <TableHead>{t('refundDlg.reason')}</TableHead>
                    <TableHead className="text-right">{t('pay.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.refunds.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{formatTz(r.createdAt)}</TableCell>
                      <TableCell>{t(`methods.${r.method}`)}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.reason}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatUZS(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <PayDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={{ id: inv.id, number: inv.number, due: inv.due }}
      />
      <RefundDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        invoice={{ id: inv.id, number: inv.number, paidTotal: inv.paidTotal }}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('detail.cancelConfirmTitle')}
        description={t('detail.cancelConfirmDesc', { number: inv.number })}
        confirmLabel={t('detail.cancel')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={() => cancelMutation.mutate()}
      />
    </div>
  );
}
