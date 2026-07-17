'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Activity, Banknote, Building2, TrendingUp, Users } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CSSProperties } from 'react';
import { formatUZS } from '@avishifo/shared';
import { formatDate, formatTz } from '@/lib/dates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { superadminApi } from '../api';

const COLORS = {
  primary: 'hsl(var(--primary))',
  grid: 'hsl(var(--border))',
} as const;

const tooltipContentStyle: CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  color: 'hsl(var(--card-foreground))',
  fontSize: '0.75rem',
};

const axisTick = { fill: 'hsl(var(--muted-foreground))', fontSize: 12 } as const;

export function PlatformAnalyticsView() {
  const t = useTranslations('superadmin');

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'analytics'],
    queryFn: () => superadminApi.analytics(),
  });

  const chartData = useMemo(
    () => (data?.visitsLast30dPerDay ?? []).map((d) => ({ date: d.date, count: d.count })),
    [data],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('analytics.title')} description={t('analytics.description')} />

      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title={t('analytics.activeClinics')} value={data.activeClinics} icon={Building2} />
          <StatCard title={t('analytics.totalUsers')} value={data.totalUsers} icon={Users} />
          <StatCard title={t('analytics.totalPatients')} value={data.totalPatients} icon={Activity} />
          <StatCard
            title={t('analytics.payments30d')}
            value={formatUZS(data.paymentsLast30dSum)}
            icon={Banknote}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('analytics.visitsChartTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title={t('analytics.empty.title')}
              description={t('analytics.empty.description')}
              className="h-[280px]"
            />
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="platformVisitsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.15} />
                      <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
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
                    width={48}
                  />
                  <Tooltip
                    contentStyle={tooltipContentStyle}
                    cursor={{ stroke: COLORS.grid }}
                    labelFormatter={(label: unknown) => formatDate(String(label))}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name={t('analytics.visitsSeries')}
                    stroke={COLORS.primary}
                    strokeWidth={2}
                    fill="url(#platformVisitsFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
