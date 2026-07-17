'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUZS, PaymentMethod } from '@avishifo/shared';
import { formatDate, formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import type { ReportFilters, RevenueDimension } from '../api';
import { useRevenueReport } from '../hooks';
import {
  axisTick,
  CHART_COLORS,
  formatBucketLabel,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';
import { ExportButton } from './export-button';

const DIMENSIONS: RevenueDimension[] = ['time', 'category', 'doctor', 'method'];
const KNOWN_METHODS = new Set<string>(Object.values(PaymentMethod));

export function RevenueTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const [dimension, setDimension] = useState<RevenueDimension>('time');
  const query = useRevenueReport(filters, dimension);

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        bucket: r.bucket,
        name:
          dimension === 'method' && KNOWN_METHODS.has(r.bucket)
            ? t(`methods.${r.bucket}`)
            : r.bucket,
        amount: Number(r.amount),
      })),
    [rows, dimension, t],
  );

  const total = useMemo(() => chartData.reduce((sum, r) => sum + r.amount, 0), [chartData]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
          {DIMENSIONS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={dimension === d ? 'default' : 'ghost'}
              className="h-7 px-3"
              onClick={() => setDimension(d)}
            >
              {t(`revenue.dimensions.${d}`)}
            </Button>
          ))}
        </div>
        <ExportButton
          path="/reports/revenue"
          filenameBase={`revenue-${dimension}`}
          filters={filters}
          extra={{ dimension }}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('revenue.chartTitle')}</CardTitle>
          <p className="text-sm font-semibold">
            {t('revenue.total')}: {formatUZS(total)}
          </p>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title={t('empty.title')}
              description={t('empty.description')}
              className="h-[300px]"
            />
          ) : dimension === 'time' ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="reportsRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(v: string) => formatBucketLabel(v, (d) => formatTz(d, 'dd.MM'))}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                />
                <YAxis
                  tickFormatter={(v: number) => formatUZS(v, { withCurrency: false })}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={84}
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ stroke: CHART_COLORS.grid }}
                  formatter={(value: unknown) => formatUZS(Number(value))}
                  labelFormatter={(label: unknown) =>
                    formatBucketLabel(String(label), (d) => formatDate(d))
                  }
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name={t('revenue.series')}
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  fill="url(#reportsRevenueFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData}
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
                  width={140}
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                  formatter={(value: unknown) => formatUZS(Number(value))}
                />
                <Bar
                  dataKey="amount"
                  name={t('revenue.series')}
                  fill={CHART_COLORS.primary}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
