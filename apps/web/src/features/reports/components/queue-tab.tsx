'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Timer } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDate, formatTz } from '@/lib/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import type { QueueReport, ReportFilters } from '../api';
import { useQueueReport } from '../hooks';
import {
  axisTick,
  CHART_COLORS,
  formatBucketLabel,
  legendTextStyle,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';
import { ExportButton } from './export-button';

type PerDoctorRow = QueueReport['perDoctor'][number];

export function QueueTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = useQueueReport(filters);

  const perDay = useMemo(() => query.data?.perDay ?? [], [query.data]);

  const columns = useMemo<ColumnDef<PerDoctorRow>[]>(() => {
    const minutes = (v: number | null): string =>
      v === null ? '—' : t('units.minutes', { value: Math.round(v) });
    return [
      {
        accessorKey: 'fullName',
        header: t('queue.columns.doctor'),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      { accessorKey: 'tickets', header: t('queue.columns.tickets') },
      {
        accessorKey: 'avgWaitMin',
        header: t('queue.columns.avgWait'),
        cell: ({ row }) => minutes(row.original.avgWaitMin),
      },
      {
        accessorKey: 'avgServiceMin',
        header: t('queue.columns.avgService'),
        cell: ({ row }) => minutes(row.original.avgServiceMin),
      },
    ];
  }, [t]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton path="/reports/queue" filenameBase="queue" filters={filters} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('queue.chartTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <Skeleton className="h-[300px] w-full" />
          ) : perDay.length === 0 ? (
            <EmptyState
              icon={Timer}
              title={t('empty.title')}
              description={t('empty.description')}
              className="h-[300px]"
            />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={perDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(v: string) => formatBucketLabel(v, (d) => formatTz(d, 'dd.MM'))}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ stroke: CHART_COLORS.grid }}
                  labelFormatter={(label: unknown) =>
                    formatBucketLabel(String(label), (d) => formatDate(d))
                  }
                  formatter={(value: unknown) =>
                    t('units.minutes', { value: Math.round(Number(value)) })
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value: unknown) => (
                    <span style={legendTextStyle}>{String(value)}</span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="avgWaitMin"
                  name={t('queue.wait')}
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="avgServiceMin"
                  name={t('queue.service')}
                  stroke={CHART_COLORS.success}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('queue.perDoctor')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={query.data?.perDoctor ?? []}
            isLoading={query.isPending}
            emptyText={t('empty.title')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
