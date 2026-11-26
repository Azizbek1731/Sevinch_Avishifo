'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, FlaskConical, Users, Wallet } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUZS } from '@avishifo/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import type {
  ReportFilters,
  ServiceDetailLineRow,
  ServiceDetailGroupRow,
  ServiceReportRow,
} from '../api';
import { useServiceDetailReport } from '../hooks';
import {
  axisTick,
  CHART_COLORS,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';
import { ExportButton } from './export-button';
import { ReportKpi, ReportSection } from './report-ui';

export function ServicesTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = useServiceDetailReport(filters);
  const [groupFilter, setGroupFilter] = useState<string | 'ALL'>('ALL');

  const groups = query.data?.byGroup ?? [];
  const services = useMemo(() => {
    const rows = query.data?.byService ?? [];
    if (groupFilter === 'ALL') return rows;
    return rows.filter((r) => r.group === groupFilter);
  }, [query.data?.byService, groupFilter]);

  const lines = useMemo(() => {
    const rows = query.data?.lines ?? [];
    if (groupFilter === 'ALL') return rows;
    return rows.filter((r) => r.group === groupFilter);
  }, [query.data?.lines, groupFilter]);

  const groupColumns = useMemo<ColumnDef<ServiceDetailGroupRow>[]>(
    () => [
      { accessorKey: 'label', header: t('services.columns.group') },
      { accessorKey: 'services', header: t('services.columns.serviceTypes') },
      { accessorKey: 'count', header: t('services.columns.count') },
      { accessorKey: 'patients', header: t('services.columns.patients') },
      {
        accessorKey: 'revenue',
        header: t('services.columns.revenue'),
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">{formatUZS(row.original.revenue)}</span>
        ),
      },
    ],
    [t],
  );

  const serviceColumns = useMemo<ColumnDef<ServiceReportRow>[]>(
    () => [
      {
        accessorKey: 'group',
        header: t('services.columns.group'),
        cell: ({ row }) => (
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.group ?? '—'}
          </span>
        ),
      },
      { accessorKey: 'code', header: t('services.columns.code') },
      {
        accessorKey: 'name',
        header: t('services.columns.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: 'count',
        header: t('services.columns.count'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.count}</span>,
      },
      {
        accessorKey: 'patients',
        header: t('services.columns.patients'),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.patients ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'revenue',
        header: t('services.columns.revenue'),
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">{formatUZS(row.original.revenue)}</span>
        ),
      },
    ],
    [t],
  );

  const lineColumns = useMemo<ColumnDef<ServiceDetailLineRow>[]>(
    () => [
      {
        accessorKey: 'issuedAt',
        header: t('services.columns.date'),
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {new Date(row.original.issuedAt)
              .toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' })
              .slice(0, 16)}
          </span>
        ),
      },
      {
        accessorKey: 'group',
        header: t('services.columns.group'),
        cell: ({ row }) => (
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.group}
          </span>
        ),
      },
      { accessorKey: 'serviceName', header: t('services.columns.name') },
      {
        accessorKey: 'quantity',
        header: t('services.columns.qty'),
        cell: ({ row }) => <span className="tabular-nums">{row.original.quantity}</span>,
      },
      {
        accessorKey: 'lineTotal',
        header: t('services.columns.revenue'),
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">{formatUZS(row.original.lineTotal)}</span>
        ),
      },
      {
        id: 'patient',
        header: t('services.columns.patient'),
        cell: ({ row }) => (
          <div className="min-w-[10rem]">
            <p className="font-medium leading-tight">{row.original.patientName}</p>
            <p className="text-xs text-muted-foreground">{row.original.patientMrn}</p>
          </div>
        ),
      },
      {
        accessorKey: 'performerName',
        header: t('services.columns.performer'),
        cell: ({ row }) => row.original.performerName ?? '—',
      },
    ],
    [t],
  );

  const chartData = useMemo(
    () =>
      groups.map((g) => ({
        name: g.label,
        count: g.count,
        revenue: Number(g.revenue),
      })),
    [groups],
  );

  const totals = query.data?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/40 p-1">
          <Button
            type="button"
            size="sm"
            variant={groupFilter === 'ALL' ? 'default' : 'ghost'}
            className="h-8 rounded-lg"
            onClick={() => setGroupFilter('ALL')}
          >
            {t('services.allGroups')}
          </Button>
          {groups.map((g) => (
            <Button
              key={g.group}
              type="button"
              size="sm"
              variant={groupFilter === g.group ? 'default' : 'ghost'}
              className="h-8 rounded-lg"
              onClick={() => setGroupFilter(g.group)}
            >
              {g.label}
              <span className="ml-1.5 tabular-nums opacity-70">{g.count}</span>
            </Button>
          ))}
        </div>
        <ExportButton
          path="/reports/service-detail"
          filenameBase="xizmatlar-batafsil"
          filters={filters}
        />
      </div>

      {query.isPending ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-[88px] rounded-xl" />
          <Skeleton className="h-[88px] rounded-xl" />
          <Skeleton className="h-[88px] rounded-xl" />
        </div>
      ) : totals ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <ReportKpi label={t('services.kpi.count')} value={totals.count} icon={FlaskConical} />
          <ReportKpi label={t('services.kpi.patients')} value={totals.patients} icon={Users} />
          <ReportKpi
            label={t('services.kpi.revenue')}
            value={formatUZS(totals.revenue)}
            icon={Wallet}
          />
        </div>
      ) : null}

      <ReportSection title={t('services.groupsTitle')}>
        {query.isPending ? (
          <Skeleton className="h-[260px] w-full rounded-lg" />
        ) : chartData.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                />
                <Bar
                  dataKey="count"
                  name={t('services.columns.count')}
                  fill={CHART_COLORS.primary}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportSection>

      <ReportSection title={t('services.groupsTable')}>
        {query.isPending ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <DataTable columns={groupColumns} data={groups} />
        )}
      </ReportSection>

      <ReportSection title={t('services.chartTitle')}>
        {query.isPending ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : services.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        ) : (
          <DataTable columns={serviceColumns} data={services} />
        )}
      </ReportSection>

      <ReportSection
        title={t('services.patientsTitle')}
        description={query.data?.linesTruncated ? t('services.truncatedHint') : undefined}
      >
        {query.isPending ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : lines.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title={t('empty.title')}
            description={t('empty.description')}
          />
        ) : (
          <DataTable columns={lineColumns} data={lines} />
        )}
      </ReportSection>
    </div>
  );
}
