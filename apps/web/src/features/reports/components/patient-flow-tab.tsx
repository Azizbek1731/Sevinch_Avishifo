'use client';

import { Fragment, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { PieChart as PieChartIcon, Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PATIENT_SOURCES } from '@avishifo/shared';
import { formatDate, formatTz } from '@/lib/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import type { PeakHoursMatrix, ReportFilters, SourceCount } from '../api';
import { usePatientFlowReport } from '../hooks';
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

const KNOWN_SOURCES = new Set<string>(PATIENT_SOURCES);
const PIE_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.muted,
] as const;

function PeakHoursHeatmap({ matrix }: { matrix: PeakHoursMatrix }) {
  const t = useTranslations('reports');
  const max = Math.max(1, ...matrix.rows.flatMap((r) => r.counts));

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[560px] gap-[2px]"
        style={{
          gridTemplateColumns: `2.75rem repeat(${matrix.hours.length}, minmax(1.1rem, 1fr))`,
        }}
      >
        <div />
        {matrix.hours.map((h) => (
          <div key={h} className="pb-1 text-center text-[10px] text-muted-foreground">
            {h}
          </div>
        ))}
        {matrix.rows.map((row) => (
          <Fragment key={row.dow}>
            <div className="flex items-center pr-1 text-xs text-muted-foreground">
              {t(`dow.d${row.dow % 7}`)}
            </div>
            {row.counts.map((count, i) => (
              <div
                key={`${row.dow}-${matrix.hours[i]}`}
                title={`${t(`dow.d${row.dow % 7}`)} ${matrix.hours[i]}:00 — ${t('flow.visitsAt', { count })}`}
                className="aspect-square rounded-sm"
                style={{
                  backgroundColor:
                    count > 0
                      ? `hsl(var(--primary) / ${(0.12 + 0.88 * (count / max)).toFixed(2)})`
                      : 'hsl(var(--muted) / 0.5)',
                }}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SourcesPie({ data }: { data: SourceCount[] }) {
  const t = useTranslations('reports');

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
        className="h-[300px]"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
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
            <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
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
  );
}

export function PatientFlowTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const query = usePatientFlowReport(filters);

  const flowData = useMemo(
    () =>
      (query.data?.newVsReturning ?? []).map((b) => ({
        bucket: b.bucket,
        newCount: b.newCount,
        returningCount: b.returningCount,
      })),
    [query.data],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton path="/reports/patient-flow" filenameBase="patient-flow" filters={filters} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('flow.chartTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isPending ? (
              <Skeleton className="h-[300px] w-full" />
            ) : flowData.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t('empty.title')}
                description={t('empty.description')}
                className="h-[300px]"
              />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={flowData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={CHART_COLORS.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="bucket"
                    tickFormatter={(v: string) =>
                      formatBucketLabel(v, (d) => formatTz(d, 'dd.MM'))
                    }
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
                    cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                    labelFormatter={(label: unknown) =>
                      formatBucketLabel(String(label), (d) => formatDate(d))
                    }
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value: unknown) => (
                      <span style={legendTextStyle}>{String(value)}</span>
                    )}
                  />
                  <Bar
                    dataKey="newCount"
                    name={t('flow.new')}
                    stackId="flow"
                    fill={CHART_COLORS.primary}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="returningCount"
                    name={t('flow.returning')}
                    stackId="flow"
                    fill={CHART_COLORS.success}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('flow.peakHours')}</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isPending ? (
              <Skeleton className="h-[220px] w-full" />
            ) : !query.data || query.data.peakHours.rows.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t('empty.title')}
                description={t('empty.description')}
                className="h-[220px]"
              />
            ) : (
              <PeakHoursHeatmap matrix={query.data.peakHours} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('flow.sources')}</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isPending ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <SourcesPie data={query.data?.sources ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
