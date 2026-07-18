'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { formatUZS } from '@avishifo/shared';
import { cn } from '@/lib/utils';
import { formatTz } from '@/lib/dates';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import type { CashierShiftRow, ReportFilters } from '../api';
import { useCashierShiftsReport } from '../hooks';
import { ExportButton } from './export-button';

export function ShiftsTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = useCashierShiftsReport(filters);

  const columns = useMemo<ColumnDef<CashierShiftRow>[]>(() => {
    const money = (v: string | null): string => (v === null ? '—' : formatUZS(v));
    return [
      {
        accessorKey: 'cashierName',
        header: t('shifts.columns.cashier'),
        cell: ({ row }) => <span className="font-medium">{row.original.cashierName}</span>,
      },
      {
        accessorKey: 'status',
        header: t('shifts.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} group="shift" />,
      },
      {
        accessorKey: 'openedAt',
        header: t('shifts.columns.openedAt'),
        cell: ({ row }) => formatTz(row.original.openedAt),
      },
      {
        accessorKey: 'closedAt',
        header: t('shifts.columns.closedAt'),
        cell: ({ row }) => (row.original.closedAt ? formatTz(row.original.closedAt) : '—'),
      },
      {
        accessorKey: 'openingCash',
        header: t('shifts.columns.opening'),
        cell: ({ row }) => formatUZS(row.original.openingCash),
      },
      {
        accessorKey: 'expectedCash',
        header: t('shifts.columns.expected'),
        cell: ({ row }) => money(row.original.expectedCash),
      },
      {
        accessorKey: 'actualCash',
        header: t('shifts.columns.actual'),
        cell: ({ row }) => money(row.original.actualCash),
      },
      {
        accessorKey: 'difference',
        header: t('shifts.columns.difference'),
        cell: ({ row }) => {
          const diff = row.original.difference;
          if (diff === null) return '—';
          const n = Number(diff);
          return (
            <span
              className={cn(
                'font-medium',
                n < 0 && 'text-destructive',
                n > 0 && 'text-success',
                n === 0 && 'text-muted-foreground',
              )}
            >
              {formatUZS(diff)}
            </span>
          );
        },
      },
    ];
  }, [t]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton path="/reports/cashier-shifts" filenameBase="cashier-shifts" filters={filters} />
      </div>
      <DataTable
        columns={columns}
        data={query.data ?? []}
        isLoading={query.isPending}
        emptyText={t('empty.title')}
      />
    </div>
  );
}
