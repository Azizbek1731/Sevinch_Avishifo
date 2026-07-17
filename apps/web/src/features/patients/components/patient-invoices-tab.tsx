'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Wallet } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { useSocketEvent } from '@/hooks/use-socket';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatTz } from '@/lib/dates';
import type { BalanceTransaction, PatientInvoice } from '../api';
import { usePatientBalance, usePatientInvoices, usePermissions } from '../hooks';

export function PatientInvoicesTab({ patientId }: { patientId: string }) {
  const t = useTranslations('patients');
  const can = usePermissions();
  const queryClient = useQueryClient();

  const canInvoices = can('invoices.read');
  const canBalance = can('payments.create');

  const [invoicePage, setInvoicePage] = useState(1);
  const [txPage, setTxPage] = useState(1);

  const invoices = usePatientInvoices(patientId, invoicePage, canInvoices);
  const balance = usePatientBalance(patientId, txPage, canBalance);

  // Payments land via WS → refresh financial data (REST stays source of truth).
  useSocketEvent('invoice.paid', () => {
    void queryClient.invalidateQueries({ queryKey: ['invoices', 'by-patient', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['patients', 'balance', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['patients', 'detail', patientId] });
  });

  const invoiceColumns = useMemo<ColumnDef<PatientInvoice>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('invoices.number'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: t('invoices.date'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatTz(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: 'total',
        header: t('invoices.total'),
        cell: ({ row }) => <span className="whitespace-nowrap">{formatUZS(row.original.total)}</span>,
      },
      {
        accessorKey: 'paidTotal',
        header: t('invoices.paid'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatUZS(row.original.paidTotal)}</span>
        ),
      },
      {
        accessorKey: 'due',
        header: t('invoices.due'),
        cell: ({ row }) => {
          const hasDue = !row.original.due.startsWith('0.') && row.original.due !== '0';
          return (
            <span className={cn('whitespace-nowrap', hasDue && 'font-medium text-destructive')}>
              {formatUZS(row.original.due)}
            </span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: t('invoices.status'),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            label={t(`invoiceStatus.${row.original.status}` as never)}
          />
        ),
      },
    ],
    [t],
  );

  const txColumns = useMemo<ColumnDef<BalanceTransaction>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('balance.date'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatTz(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: t('balance.type'),
        cell: ({ row }) => <StatusBadge status={row.original.type} label={t(`txType.${row.original.type}` as never)} />,
      },
      {
        accessorKey: 'amount',
        header: t('balance.amount'),
        cell: ({ row }) => {
          const negative = row.original.amount.startsWith('-');
          return (
            <span
              className={cn(
                'whitespace-nowrap font-medium',
                negative ? 'text-destructive' : 'text-success',
              )}
            >
              {formatUZS(row.original.amount)}
            </span>
          );
        },
      },
      {
        accessorKey: 'note',
        header: t('balance.note'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.note ?? '—'}</span>
        ),
      },
    ],
    [t],
  );

  const balanceValue = balance.data?.data.balance;
  const balanceNegative = balanceValue?.startsWith('-') ?? false;
  const txMeta = balance.data?.data.transactions.meta;

  return (
    <div className="space-y-6">
      {canInvoices ? (
        <div className="space-y-2">
          <h3 className="text-base font-semibold">{t('invoices.title')}</h3>
          <DataTable
            columns={invoiceColumns}
            data={invoices.data?.data ?? []}
            isLoading={invoices.isLoading}
            emptyText={t('invoices.empty')}
            meta={
              invoices.data?.meta
                ? {
                    page: invoices.data.meta.page,
                    limit: invoices.data.meta.limit,
                    total: invoices.data.meta.total,
                  }
                : undefined
            }
            onPageChange={setInvoicePage}
          />
        </div>
      ) : null}

      {canBalance ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t('balance.title')}</CardTitle>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span
                className={cn(
                  'text-lg font-bold',
                  balanceNegative ? 'text-destructive' : 'text-success',
                )}
              >
                {balanceValue !== undefined ? formatUZS(balanceValue) : '—'}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={txColumns}
              data={balance.data?.data.transactions.items ?? []}
              isLoading={balance.isLoading}
              emptyText={t('balance.empty')}
              meta={
                txMeta
                  ? { page: txMeta.page, limit: txMeta.limit, total: txMeta.total }
                  : undefined
              }
              onPageChange={setTxPage}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
