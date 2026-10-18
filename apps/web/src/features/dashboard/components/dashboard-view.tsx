'use client';

import { useTranslations } from 'next-intl';
import { Banknote, Hourglass, Stethoscope, UserPlus } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDashboardRealtime,
  useDashboardSummary,
  usePatientFlow,
  useRevenueSeries,
} from '../hooks';
import { PatientFlowChart } from './patient-flow-chart';
import { RevenueAreaChart } from './revenue-area-chart';
import { SourcesDonut } from './sources-donut';

export function DashboardView() {
  const t = useTranslations('dashboard');
  useDashboardRealtime();

  const summary = useDashboardSummary();
  const revenue = useRevenueSeries();
  const flow = usePatientFlow();

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {summary.isPending ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[116px] rounded-lg" />
          ))
        ) : (
          <>
            <StatCard
              title={t('stats.revenue')}
              value={summary.data ? formatUZS(summary.data.revenue) : '—'}
              icon={Banknote}
              hint={
                summary.data
                  ? t('stats.openShifts', { count: summary.data.openShifts })
                  : undefined
              }
            />
            <StatCard
              title={t('stats.visits')}
              value={summary.data?.visitsCount ?? '—'}
              icon={Stethoscope}
            />
            <StatCard
              title={t('stats.newPatients')}
              value={summary.data?.newPatients ?? '—'}
              icon={UserPlus}
            />
            <StatCard
              title={t('stats.waiting')}
              value={summary.data?.waitingNow ?? '—'}
              icon={Hourglass}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('charts.revenue30')}</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.isPending ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <RevenueAreaChart data={revenue.data ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('charts.patientFlow')}</CardTitle>
          </CardHeader>
          <CardContent>
            {flow.isPending ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <PatientFlowChart data={flow.data?.newVsReturning ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('charts.sources')}</CardTitle>
          </CardHeader>
          <CardContent>
            {flow.isPending ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <SourcesDonut data={flow.data?.sources ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
