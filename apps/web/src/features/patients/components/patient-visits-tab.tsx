'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatTz } from '@/lib/dates';
import type { PatientVisit } from '../api';
import { usePatientVisits } from '../hooks';

export function PatientVisitsTab({ patientId }: { patientId: string }) {
  const t = useTranslations('patients');
  const tr = useTranslations('doctor.clinical');
  const [page, setPage] = useState(1);

  const query = usePatientVisits(patientId, page, true);
  const items = query.data?.data ?? [];
  const meta = query.data?.meta;

  const columns = useMemo<ColumnDef<PatientVisit>[]>(
    () => [
      {
        accessorKey: 'startedAt',
        header: t('visits.date'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.startedAt ? formatTz(row.original.startedAt) : '—'}
          </span>
        ),
      },
      {
        id: 'kind',
        header: tr('services'),
        cell: ({ row }) => (
          <span>
            {row.original.reportTitle ||
              tr(row.original.kind === 'ULTRASOUND' ? 'ultrasound' : 'consultation')}
          </span>
        ),
      },
      {
        accessorKey: 'doctor',
        header: t('visits.doctor'),
        cell: ({ row }) => <span className="font-medium">{row.original.doctor.fullName}</span>,
      },
      {
        accessorKey: 'status',
        header: t('visits.status'),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            label={t(`visitStatus.${row.original.status}` as never)}
          />
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm">
            <Link href={`/doctor/visits/${row.original.id}`}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              {t('visits.open')}
            </Link>
          </Button>
        ),
      },
    ],
    [t, tr],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      isLoading={query.isLoading}
      emptyText={t('visits.empty')}
      meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
      onPageChange={setPage}
    />
  );
}
