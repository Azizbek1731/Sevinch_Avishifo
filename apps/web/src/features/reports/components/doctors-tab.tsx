'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { formatUZS } from '@avishifo/shared';
import { DataTable } from '@/components/data-table';
import type { DoctorReportRow, ReportFilters } from '../api';
import { useDoctorsReport } from '../hooks';
import { ExportButton } from './export-button';

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

export function DoctorsTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = useDoctorsReport(filters);

  const columns = useMemo<ColumnDef<DoctorReportRow>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: t('doctors.columns.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      { accessorKey: 'patientsSeen', header: t('doctors.columns.patients') },
      { accessorKey: 'visits', header: t('doctors.columns.visits') },
      {
        accessorKey: 'revenue',
        header: t('doctors.columns.revenue'),
        cell: ({ row }) => formatUZS(row.original.revenue),
      },
      {
        accessorKey: 'avgVisitMin',
        header: t('doctors.columns.avgDuration'),
        cell: ({ row }) =>
          row.original.avgVisitMin === null
            ? '—'
            : t('units.minutes', { value: Math.round(row.original.avgVisitMin) }),
      },
      {
        accessorKey: 'noShowRate',
        header: t('doctors.columns.noShow'),
        cell: ({ row }) => formatRate(row.original.noShowRate),
      },
      {
        accessorKey: 'returningRate',
        header: t('doctors.columns.returning'),
        cell: ({ row }) => formatRate(row.original.returningRate),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton path="/reports/doctors" filenameBase="doctors" filters={filters} />
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
