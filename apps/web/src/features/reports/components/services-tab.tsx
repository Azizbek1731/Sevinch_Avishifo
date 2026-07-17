'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3 } from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import type { ReportFilters, ServiceReportRow } from '../api';
import { useServicesReport } from '../hooks';
import {
  axisTick,
  CHART_COLORS,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';
import { ExportButton } from './export-button';

export function ServicesTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = useServicesReport(filters);

  const columns = useMemo<ColumnDef<ServiceReportRow>[]>(
    () => [
      { accessorKey: 'code', header: t('services.columns.code') },
      {
        accessorKey: 'name',
        header: t('services.columns.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      { accessorKey: 'count', header: t('services.columns.count') },
      {
        accessorKey: 'revenue',
        header: t('services.columns.revenue'),
        cell: ({ row }) => formatUZS(row.original.revenue),
      },
    ],
    [t],
  );

  const topByRevenue = useMemo(
    () =>
      [...(query.data ?? [])]
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 8)
        .map((s) => ({ name: s.name, revenue: Number(s.revenue) })),
    [query.data],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton path="/reports/services" filenameBase="services" filters={filters} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('services.chartTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <Skeleton className="h-[300px] w-full" />
          ) : topByRevenue.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={t('empty.title')}
              description={t('empty.description')}
              className="h-[300px]"
            />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={topByRevenue}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v: number) => formatUZS(v, { withCurrency: false })}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={160}
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                  formatter={(value: unknown) => formatUZS(Number(value))}
                />
                <Bar
                  dataKey="revenue"
                  name={t('services.series')}
                  fill={CHART_COLORS.primary}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={query.data ?? []}
        isLoading={query.isPending}
        emptyText={t('empty.title')}
      />
    </div>
  );
}
