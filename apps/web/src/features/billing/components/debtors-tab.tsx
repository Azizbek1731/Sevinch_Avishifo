'use client';

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { HandCoins } from 'lucide-react';
import { formatPhone, formatUZS } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatDate } from '@/lib/dates';
import { DataTable } from '@/components/data-table';
import { StatCard } from '@/components/stat-card';
import { billingApi, type DebtorRow } from '../api';

export function DebtorsTab() {
  const t = useTranslations('cashier');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['debtors', { page }],
    queryFn: async () => (await billingApi.listDebtors({ page })).data,
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<DebtorRow>[]>(
    () => [
      {
        id: 'patient',
        header: t('debtors.patient'),
        cell: ({ row }) => (
          <Link
            href={`/patients/${row.original.patient.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.patient.fullName}
          </Link>
        ),
      },
      {
        id: 'phone',
        header: t('debtors.phone'),
        cell: ({ row }) =>
          row.original.patient.phone ? formatPhone(row.original.patient.phone) : '—',
      },
      {
        id: 'oldest',
        header: t('debtors.oldestInvoice'),
        cell: ({ row }) =>
          row.original.oldestInvoiceDate ? formatDate(row.original.oldestInvoiceDate) : '—',
      },
      {
        id: 'debt',
        header: t('debtors.debt'),
        cell: ({ row }) => (
          <span className="font-semibold text-destructive">{formatUZS(row.original.debt)}</span>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <StatCard
        className="max-w-xs"
        title={t('debtors.totalDebt')}
        value={data ? formatUZS(data.totalDebt) : '—'}
        icon={HandCoins}
      />
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        meta={data?.meta}
        isLoading={isLoading}
        onPageChange={setPage}
        emptyText={t('debtors.empty')}
      />
    </div>
  );
}
