'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, DoorOpen, Timer, Users } from 'lucide-react';
import { TicketStatus, type QueueStatsPayload } from '@avishifo/shared';
import { StatCard } from '@/components/stat-card';
import type { QueueListItem } from '../api';

export interface StatsBarProps {
  queues: QueueListItem[];
  /** Live branch stats from `queue.stats.updated` (today only). */
  stats: QueueStatsPayload | null;
  isToday: boolean;
}

export function StatsBar({ queues, stats, isToday }: StatsBarProps) {
  const t = useTranslations('queue');

  const tickets = queues.flatMap((q) => q.tickets);
  const count = (status: TicketStatus) => tickets.filter((tk) => tk.status === status).length;

  const live = isToday ? stats : null;
  const waiting = live?.waiting ?? count(TicketStatus.WAITING);
  const avgWait = live ? t('wait.min', { min: Math.round(live.avgWaitMin) }) : '—';

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard title={t('stats.waiting')} value={waiting} icon={Users} />
      <StatCard title={t('stats.avgWait')} value={avgWait} icon={Timer} />
      <StatCard title={t('stats.inRoom')} value={count(TicketStatus.IN_ROOM)} icon={DoorOpen} />
      <StatCard title={t('stats.done')} value={count(TicketStatus.DONE)} icon={CheckCircle2} />
    </div>
  );
}
