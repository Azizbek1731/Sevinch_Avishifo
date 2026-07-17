'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { FlaskConical } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CartesianGrid,
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
import type { LabTurnaroundReport, ReportFilters } from '../api';
import { useLabTurnaroundReport } from '../hooks';
import {
  axisTick,
  CHART_COLORS,
  formatBucketLabel,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';
import { ExportButton } from './export-button';

type PerTestRow = LabTurnaroundReport['perTest'][number];

export function LabTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = useLabTurnaroundReport(filters);

  const perDay = useMemo(() => query.data?.perDay ?? [], [query.data]);

  const columns = useMemo<ColumnDef<PerTestRow>[]>(() => {
    const hours = (v: number | null): string =>
      v === null ? '—' : t('units.hours', { value: v.toFixed(1) });
    return [
      {
        accessorKey: 'name',
        header: t('lab.columns.test'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      { accessorKey: 'count', header: t('lab.columns.count') },
      {
        accessorKey: 'avgHours',
        header: t('lab.columns.avgHours'),
        cell: ({ row }) => hours(row.original.avgHours),
      },
    ];
  }, [t]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton path="/reports/lab-turnaround" filenameBase="lab-turnaround" filters={filters} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('lab.chartTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <Skeleton className="h-[300px] w-full" />
          ) : perDay.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
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
                <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ stroke: CHART_COLORS.grid }}
                  labelFormatter={(label: unknown) =>
                    formatBucketLabel(String(label), (d) => formatDate(d))
                  }
                  formatter={(value: unknown) =>
                    t('units.hours', { value: Number(value).toFixed(1) })
                  }
                />
                <Line
                  type="monotone"
                  dataKey="avgHours"
                  name={t('lab.series')}
                  stroke={CHART_COLORS.primary}
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
          <CardTitle className="text-base">{t('lab.perTest')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={query.data?.perTest ?? []}
            isLoading={query.isPending}
            emptyText={t('empty.title')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
