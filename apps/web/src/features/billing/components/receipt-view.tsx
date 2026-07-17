'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Printer, ReceiptText } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { billingApi } from '../api';

export function ReceiptView({ id }: { id: string }) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', id, 'receipt'],
    queryFn: async () => (await billingApi.getReceipt(id)).data,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xs space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return <EmptyState icon={ReceiptText} title={tc('notFound')} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/invoices/${id}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {tc('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" />
          {t('receipt.print')}
        </Button>
      </div>

      {/* 80mm thermal receipt */}
      <div className="mx-auto w-full max-w-[80mm]">
        <div className="print-area rounded-md border bg-card p-4 font-mono text-xs leading-relaxed">
          <div className="text-center">
            <p className="text-sm font-bold uppercase">{data.clinic?.name ?? ''}</p>
            {data.branch ? <p>{data.branch.name}</p> : null}
            {data.branch?.address ? <p>{data.branch.address}</p> : null}
            {data.branch?.phone ? <p>{data.branch.phone}</p> : null}
            {data.clinic?.taxId ? (
              <p>
                {t('receipt.taxId')}: {data.clinic.taxId}
              </p>
            ) : null}
          </div>

          <Separator className="my-2" />

          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>{t('receipt.receiptNo')}</span>
              <span className="font-bold">{data.invoice.number}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('receipt.date')}</span>
              <span>{formatTz(data.printedAt)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{t('receipt.patient')}</span>
              <span className="text-right">{data.patient.fullName}</span>
            </div>
            {user ? (
              <div className="flex justify-between gap-2">
                <span>{t('receipt.cashier')}</span>
                <span className="text-right">{user.fullName}</span>
              </div>
            ) : null}
          </div>

          <Separator className="my-2" />

          <div className="space-y-1">
            {data.lines.map((l) => (
              <div key={l.id}>
                <p>{l.title ?? ''}</p>
                <div className="flex justify-between">
                  <span>
                    {l.quantity} x {formatUZS(l.unitPrice, { withCurrency: false })}
                  </span>
                  <span className="font-semibold">
                    {formatUZS(l.lineTotal, { withCurrency: false })}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Separator className="my-2" />

          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>{t('receipt.subtotal')}</span>
              <span>{formatUZS(data.totals.subtotal, { withCurrency: false })}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('receipt.discount')}</span>
              <span>{formatUZS(data.totals.discountTotal, { withCurrency: false })}</span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span>{t('receipt.total')}</span>
              <span>{formatUZS(data.totals.total)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('receipt.paid')}</span>
              <span>{formatUZS(data.totals.paidTotal, { withCurrency: false })}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('receipt.due')}</span>
              <span>{formatUZS(data.totals.due, { withCurrency: false })}</span>
            </div>
          </div>

          {data.payments.length > 0 ? (
            <>
              <Separator className="my-2" />
              <div className="space-y-0.5">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span>
                      {t(`methods.${p.method}`)} · {formatTz(p.paidAt, 'dd.MM HH:mm')}
                    </span>
                    <span>{formatUZS(p.amount, { withCurrency: false })}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <Separator className="my-2" />
          <p className="text-center">{t('receipt.thanks')}</p>
        </div>
      </div>
    </div>
  );
}
