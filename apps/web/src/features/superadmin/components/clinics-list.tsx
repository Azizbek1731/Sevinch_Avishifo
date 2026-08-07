'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { ClinicStatus, SUBSCRIPTION_FILTERS, type SubscriptionFilter } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { superadminApi, type ClinicListItem } from '../api';
import { usePermission } from '../hooks';
import { CreateClinicDialog } from './create-clinic-dialog';

const ALL_STATUSES = 'ALL';

export function ClinicsListView() {
  const t = useTranslations('superadmin');
  const enumLabel = useEnumLabel();
  const can = usePermission();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClinicStatus | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionFilter | null>(null);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'clinics', { search, status, subscription, page }],
    queryFn: () => superadminApi.listClinics({ search, status, subscription, page }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<ClinicListItem>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('clinics.columns.name'),
        cell: ({ row }) => (
          <Link
            href={`/platform/clinics/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'status',
        header: t('clinics.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} group="clinic" />,
      },
      {
        id: 'plan',
        header: t('clinics.columns.plan'),
        cell: ({ row }) =>
          row.original.subscription ? (
            row.original.subscription.plan.name
          ) : (
            <span className="text-muted-foreground">{t('clinics.noPlan')}</span>
          ),
      },
      {
        id: 'subscription',
        header: t('clinics.columns.subscription'),
        cell: ({ row }) => {
          const sub = row.original.subscription;
          if (!sub) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={sub.status} group="subscription" />
              {sub.isExpired ? (
                <span className="text-xs font-medium text-destructive">
                  {t('clinics.expired')}
                </span>
              ) : sub.daysLeft !== null ? (
                <span
                  className={cn(
                    'text-xs font-medium tabular-nums',
                    sub.daysLeft <= 3 ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground',
                  )}
                >
                  {t('clinics.daysLeft', { days: sub.daysLeft })}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'branches',
        header: t('clinics.columns.branches'),
        cell: ({ row }) => row.original.usage.branches,
      },
      {
        id: 'users',
        header: t('clinics.columns.users'),
        cell: ({ row }) => row.original.usage.users,
      },
      {
        id: 'patients',
        header: t('clinics.columns.patients'),
        cell: ({ row }) => row.original.usage.patients,
      },
      {
        id: 'visits30d',
        header: t('clinics.columns.visits30d'),
        cell: ({ row }) => row.original.usage.visitsLast30d,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('clinics.title')} description={t('clinics.description')}>
        {can('platform.clinics.write') ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('clinics.create')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t('clinics.searchPlaceholder')}
          className="w-64"
        />
        <Select
          value={status ?? ALL_STATUSES}
          onValueChange={(v) => {
            setStatus(v === ALL_STATUSES ? null : (v as ClinicStatus));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>{t('clinics.allStatuses')}</SelectItem>
            {Object.values(ClinicStatus).map((s) => (
              <SelectItem key={s} value={s}>
                {enumLabel('clinic', s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={subscription ?? ALL_STATUSES}
          onValueChange={(v) => {
            setSubscription(v === ALL_STATUSES ? null : (v as SubscriptionFilter));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>{t('clinics.allSubscriptions')}</SelectItem>
            {SUBSCRIPTION_FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {t(`clinics.subscriptionFilter.${f}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        meta={data?.meta}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyText={t('clinics.empty.title')}
      />

      <CreateClinicDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
