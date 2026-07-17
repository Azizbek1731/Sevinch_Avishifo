'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { QueueKind, TicketStatus, type QueueTicketPayload } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="flex w-80 shrink-0 flex-col">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{name}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('column.waitingCount', { count: waitingCount })}
              {!queue.isOpen ? ` · ${t('column.closed')}` : ''}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 font-mono">
            {queue.prefix}
          </Badge>
        </div>
        {canCall && isToday ? (
          <CallNextButton queueId={queue.id} disabled={waitingCount === 0 || !queue.isOpen} />
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {tickets.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t('empty.noTickets')}
          </p>
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
