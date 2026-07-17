'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Activity,
  CalendarX,
  Clock,
  Repeat,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { StatCard } from '@/components/stat-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTz, todayTashkent } from '@/lib/dates';
import { useDoctorKpi } from '../hooks';

const DAY_MS = 24 * 60 * 60 * 1000;

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function KpiTab({ userId }: { userId: string }) {
  const t = useTranslations('staff');

  const [from, setFrom] = useState(() => formatTz(new Date(Date.now() - 30 * DAY_MS), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => todayTashkent());

  const query = useDoctorKpi(userId, {
    from: from || undefined,
    to: to || undefined,
  });
  const kpi = query.data?.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="kpi-from">{t('kpi.from')}</Label>
          <Input
            id="kpi-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="kpi-to">{t('kpi.to')}</Label>
          <Input
            id="kpi-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-44"
          />
        </div>
      </div>

      {query.isLoading || !kpi ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatCard title={t('kpi.patientsSeen')} value={kpi.patientsSeen} icon={Users} />
          <StatCard title={t('kpi.visits')} value={kpi.visits} icon={Activity} />
          <StatCard title={t('kpi.revenue')} value={formatUZS(kpi.revenue)} icon={Wallet} />
          <StatCard
            title={t('kpi.avgVisitMin')}
            value={kpi.avgVisitMin !== null ? kpi.avgVisitMin : '—'}
            hint={kpi.avgVisitMin !== null ? t('kpi.minutesUnit') : undefined}
            icon={Clock}
          />
          <StatCard title={t('kpi.noShowRate')} value={percent(kpi.noShowRate)} icon={CalendarX} />
          <StatCard
            title={t('kpi.returningRate')}
            value={percent(kpi.returningPatientRate)}
            icon={Repeat}
          />
          <StatCard
            title={t('kpi.avgRating')}
            value={kpi.avgRating !== null ? kpi.avgRating.toFixed(2) : '—'}
            icon={Star}
          />
        </div>
      )}
    </div>
  );
}
