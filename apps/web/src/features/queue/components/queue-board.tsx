'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ListOrdered, WifiOff } from 'lucide-react';
import { QueueKind } from '@avishifo/shared';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { todayTashkent } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { useNow, useQueueBoard, useQueueStats } from '../hooks';
import { QueueColumn } from './queue-column';
import { StatsBar } from './stats-bar';
import type { TransferTarget } from './ticket-actions';

function BoardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-96 w-80 shrink-0 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function QueueBoard() {
  const t = useTranslations('queue');
  const [date, setDate] = React.useState<string>(() => todayTashkent());
  const { branchId, query, connected } = useQueueBoard(date);
  const stats = useQueueStats();
  const now = useNow(15_000);
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);

  const canCall = permissions.includes('queue.call');
  const canManage = permissions.includes('queue.manage');
  const isToday = date === todayTashkent();

  const queues = query.data ?? [];
  const doctorQueues: TransferTarget[] = queues
    .filter((q) => q.kind === QueueKind.DOCTOR && q.isOpen && q.doctorUserId)
    .map((q) => ({ doctorUserId: q.doctorUserId as string, doctorName: q.doctorName ?? '—' }));

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')}>
        {!connected ? (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <WifiOff className="h-3.5 w-3.5" />
            {t('offline')}
          </span>
        ) : null}
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayTashkent())}
          className="w-40"
          aria-label={t('date')}
        />
      </PageHeader>

      {!branchId ? (
        <EmptyState icon={ListOrdered} title={t('noBranch')} />
      ) : query.isLoading ? (
        <BoardSkeleton />
      ) : queues.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : (
        <>
          <StatsBar queues={queues} stats={stats} isToday={isToday} />
          <div className="flex items-start gap-4 overflow-x-auto pb-4">
            {queues.map((queue) => (
              <QueueColumn
                key={queue.id}
                queue={queue}
                now={now}
                isToday={isToday}
                canCall={canCall}
                canManage={canManage}
                doctorQueues={doctorQueues}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
