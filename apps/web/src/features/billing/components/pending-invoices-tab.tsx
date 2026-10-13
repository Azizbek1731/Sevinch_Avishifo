'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Banknote, ChevronLeft, ChevronRight, ReceiptText, RefreshCw, Search } from 'lucide-react';
import { formatPhone, formatUZS } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { localizedText } from '@/lib/localized';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi, type InvoiceListItem } from '../api';
import { usePermission } from '../hooks';
import { PayDialog } from './pay-dialog';
import { ReceiptPrinter } from './receipt-printer';
import type { ReceiptPrintRequest } from '../receipt-print';

const PAGE_SIZE = 20;

/** Reception issues orders; the cashier checks the patient and accepts payment. */
export function PendingInvoicesTab() {
  const t = useTranslations('billing');
  const tc = useTranslations('cashier');
  const locale = useLocale();
  const can = usePermission();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const [paying, setPaying] = useState<InvoiceListItem | null>(null);
  const [receipt, setReceipt] = useState<ReceiptPrintRequest | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = {
    pending: true,
    search: debouncedSearch || undefined,
    branchId: activeBranchId ?? undefined,
    page,
    limit: PAGE_SIZE,
  };
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['invoices', 'pending', query],
    queryFn: () => billingApi.listInvoices(query),
    refetchInterval: 5_000,
  });
  const invoices = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('pending.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('pending.description')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          {t('pending.refresh')}
        </Button>
      </div>
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          aria-label={t('pending.search')}
          placeholder={t('pending.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-32 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <p className="text-sm text-destructive">{t('pending.loadFailed')}</p>
            <Button variant="outline" onClick={() => void refetch()}>
              {tc('shift.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={search ? t('pending.noMatch') : tc('pending.empty')}
          description={search ? t('pending.searchHint') : tc('pending.emptyDesc')}
        />
      ) : (
        <div className="space-y-3">
          {invoices.map((invoice) => (
            <Card key={invoice.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{invoice.patient.fullName}</p>
                      <StatusBadge
                        status={invoice.status}
                        label={t(`statuses.${invoice.status}`)}
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{invoice.patient.mrn}</span>
                      {invoice.patient.phone ? (
                        <span>{formatPhone(invoice.patient.phone)}</span>
                      ) : null}
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="text-primary hover:underline"
                      >
                        {invoice.number}
                      </Link>
                      <span>{formatTz(invoice.createdAt)}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {invoice.lines?.length
                        ? invoice.lines
                            .map(
                              (line) =>
                                `${localizedText(line.title, locale)}${line.quantity > 1 ? ` × ${line.quantity}` : ''}`,
                            )
                            .join(' · ')
                        : t('pending.openDetails')}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{t('pay.due')}</p>
                      <p className="text-xl font-bold tabular-nums">{formatUZS(invoice.due)}</p>
                      {invoice.paidTotal !== '0.00' ? (
                        <p className="text-xs text-success">
                          {t('cols.paid')}: {formatUZS(invoice.paidTotal)}
                        </p>
                      ) : null}
                    </div>
                    {can('payments.create') ? (
                      <Button size="lg" onClick={() => setPaying(invoice)}>
                        <Banknote className="mr-2 h-5 w-5" />
                        {t('pay.submit')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!isLoading && !isError && total > 0 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">{t('pending.pagination', { page, pages, total })}</p>
          <div className="flex gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label={t('pending.previous')}
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label={t('pending.next')}
              disabled={page >= pages || isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
      {paying ? (
        <PayDialog
          open
          onOpenChange={(open) => !open && setPaying(null)}
          onPaid={setReceipt}
          invoice={{
            id: paying.id,
            number: paying.number,
            due: paying.due,
            patientName: paying.patient.fullName,
          }}
        />
      ) : null}
      {receipt ? (
        <ReceiptPrinter key={receipt.requestId} {...receipt} onPrinted={() => setReceipt(null)} />
      ) : null}
    </div>
  );
}
