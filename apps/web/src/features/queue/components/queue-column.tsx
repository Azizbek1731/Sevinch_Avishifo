'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { DoorClosed, Ticket, Users } from 'lucide-react';
import { QueueKind, TicketStatus, type QueueTicketPayload } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import type { QueueListItem } from '../api';
import { CallNextButton } from './call-next-button';
import { TicketCard } from './ticket-card';
import type { TransferTarget } from './ticket-actions';

/** Active tickets first (by position), then skipped, then done. */
const STATUS_RANK: Record<TicketStatus, number> = {
  [TicketStatus.CALLED]: 0,
  [TicketStatus.IN_ROOM]: 0,
  [TicketStatus.WAITING]: 1,
  [TicketStatus.SKIPPED]: 2,
  [TicketStatus.DONE]: 3,
};

function sortTickets(tickets: QueueTicketPayload[]): QueueTicketPayload[] {
  return [...tickets].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.position - b.position,
  );
}

export interface QueueColumnProps {
  queue: QueueListItem;
  now: number;
  isToday: boolean;
  canCall: boolean;
  canManage: boolean;
  /** All open doctor queues of the branch (for transfers to other doctors). */
  doctorQueues: TransferTarget[];
}

export function QueueColumn({
  queue,
  now,
  isToday,
  canCall,
  canManage,
  doctorQueues,
}: QueueColumnProps) {
  const t = useTranslations('queue');

  const tickets = React.useMemo(() => sortTickets(queue.tickets), [queue.tickets]);
  const waitingCount = queue.tickets.filter((tk) => tk.status === TicketStatus.WAITING).length;
  const transferTargets = doctorQueues.filter((d) => d.doctorUserId !== queue.doctorUserId);

  const name =
    queue.kind === QueueKind.DOCTOR
      ? (queue.doctorName ?? '—')
      : queue.kind === QueueKind.LAB
        ? t('column.lab')
        : t('column.custom');

  return (
    <Card
      className={cn('flex w-80 shrink-0 flex-col', !queue.isOpen && 'opacity-80')}
    >
      <CardHeader className="gap-3 space-y-0 p-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-base">{name}</CardTitle>
            {queue.kind === QueueKind.DOCTOR && queue.doctorRoomNumber ? (
              <p className="flex items-center gap-1 text-sm font-medium text-primary">
                <DoorClosed className="h-3.5 w-3.5" />
                {t('column.room', { number: queue.doctorRoomNumber })}
              </p>
            ) : null}
            <div className="flex items-center gap-1.5 pt-0.5">
              <Badge variant="outline" className="h-5 px-1.5 font-mono text-[11px] font-medium">
                {queue.prefix}
              </Badge>
              {!queue.isOpen ? (
                <span className="text-xs text-muted-foreground">{t('column.closed')}</span>
              ) : null}
            </div>
          </div>
          <Badge
            variant="outline"
            aria-label={t('column.waitingCount', { count: waitingCount })}
            className={cn(
              'shrink-0 gap-1 tabular-nums',
              waitingCount > 0
                ? 'border-transparent bg-warning/15 text-warning-foreground dark:text-warning'
                : 'text-muted-foreground',
            )}
          >
            <Users className="h-3.5 w-3.5" />
            {waitingCount}
          </Badge>
        </div>
        {canCall && isToday ? (
          <CallNextButton queueId={queue.id} disabled={waitingCount === 0 || !queue.isOpen} />
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-4 pt-0">
        {tickets.length === 0 ? (
          <EmptyState icon={Ticket} title={t('empty.noTickets')} className="px-3 py-8" />
        ) : (
          tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              now={now}
              canCall={canCall && isToday}
              canManage={canManage && isToday}
              transferTargets={transferTargets}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
