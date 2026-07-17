'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { PieChart as PieChartIcon } from 'lucide-react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PATIENT_SOURCES } from '@avishifo/shared';
import { EmptyState } from '@/components/empty-state';
import type { SourceCount } from '../api';
import {
  CHART_COLORS,
  legendTextStyle,
  tooltipContentStyle,
  tooltipItemStyle,
} from './chart-theme';

const DONUT_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.muted,
] as const;

const KNOWN_SOURCES = new Set<string>(PATIENT_SOURCES);

export function SourcesDonut({ data }: { data: SourceCount[] }) {
  const t = useTranslations('dashboard');

  // Fixed color order: top 3 sources get their own slice, the tail folds into "other".
  const chartData = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.count - a.count);
    const top = sorted.slice(0, 3);
    const restCount = sorted.slice(3).reduce((sum, s) => sum + s.count, 0);
    const rows = top.map((s) => ({
      name: KNOWN_SOURCES.has(s.source) ? t(`sources.${s.source}`) : s.source,
      value: s.count,
    }));
    if (restCount > 0) rows.push({ name: t('sources.other'), value: restCount });
    return rows;
  }, [data, t]);

  if (chartData.length === 0) {
    return (
      <EmptyState
        icon={PieChartIcon}
        title={t('empty.title')}
        description={t('empty.description')}
        className="h-[280px]"
      />
    );
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="82%"
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {chartData.map((entry, i) => (
              <Cell key={entry.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipContentStyle} itemStyle={tooltipItemStyle} />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: unknown) => <span style={legendTextStyle}>{String(value)}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
