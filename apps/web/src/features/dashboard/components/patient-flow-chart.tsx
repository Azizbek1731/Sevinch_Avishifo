'use client';

import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDate, formatTz } from '@/lib/dates';
import { EmptyState } from '@/components/empty-state';
import type { NewVsReturningBucket } from '../api';
import {
  axisTick,
  CHART_COLORS,
  legendTextStyle,
  tooltipContentStyle,
  tooltipItemStyle,
  tooltipLabelStyle,
} from './chart-theme';

export function PatientFlowChart({ data }: { data: NewVsReturningBucket[] }) {
  const t = useTranslations('dashboard');

  if (data.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('empty.title')}
        description={t('empty.description')}
        className="h-[280px]"
      />
    );
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
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
            allowDecimals={false}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            itemStyle={tooltipItemStyle}
            cursor={{ fill: 'hsl(var(--muted))', fillOpacity: 0.4 }}
            labelFormatter={(label: unknown) => formatDate(String(label))}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: unknown) => <span style={legendTextStyle}>{String(value)}</span>}
          />
          <Bar
            dataKey="new"
            name={t('charts.new')}
            fill={CHART_COLORS.primary}
            radius={[4, 4, 0, 0]}
            maxBarSize={14}
          />
          <Bar
            dataKey="returning"
            name={t('charts.returning')}
            fill={CHART_COLORS.muted}
            radius={[4, 4, 0, 0]}
            maxBarSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
