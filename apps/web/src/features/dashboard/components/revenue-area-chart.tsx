'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUZS } from '@avishifo/shared';
import { formatDate, formatTz } from '@/lib/dates';
import { EmptyState } from '@/components/empty-state';
import type { RevenuePoint } from '../api';
import {
  axisTick,
  CHART_COLORS,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';

export function RevenueAreaChart({ data }: { data: RevenuePoint[] }) {
  const t = useTranslations('dashboard');

  const chartData = useMemo(
    () => data.map((d) => ({ bucket: d.bucket, amount: Number(d.amount) })),
    [data],
  );

  if (chartData.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={t('empty.title')}
        description={t('empty.description')}
        className="h-[280px]"
      />
    );
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dashboardRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.15} />
              <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={(v: string) => formatTz(v, 'dd.MM')}
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
            labelFormatter={(label: unknown) => formatDate(String(label))}
          />
          <Area
            type="monotone"
            dataKey="amount"
            name={t('charts.revenueSeries')}
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            fill="url(#dashboardRevenueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
