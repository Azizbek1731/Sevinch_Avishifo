'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock, DoorOpen } from 'lucide-react';
import {
  TicketPriority,
  TicketStatus,
  type QueueTicketPayload,
} from '@avishifo/shared';
import { StatusBadge } from '@/components/status-badge';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { cn } from '@/lib/utils';
import { TicketActions, type TransferTarget } from './ticket-actions';

/** Status-colored left accent — theme tokens so light & dark both read right. */
const STATUS_ACCENT: Record<TicketStatus, string> = {
  [TicketStatus.WAITING]: 'border-l-warning',
  [TicketStatus.CALLED]: 'border-l-primary',
  [TicketStatus.IN_ROOM]: 'border-l-primary',
  [TicketStatus.DONE]: 'border-l-success',
  [TicketStatus.SKIPPED]: 'border-l-muted-foreground/40',
};

/** Priority chip tone (NORMAL renders nothing). */
const PRIORITY_CHIP: Record<TicketPriority, string> = {
  [TicketPriority.NORMAL]: '',
  [TicketPriority.PRIORITY]: 'bg-warning/15 text-warning-foreground dark:text-warning',
  [TicketPriority.EMERGENCY]: 'bg-destructive/10 text-destructive',
};

export interface TicketCardProps {
  ticket: QueueTicketPayload;
  now: number;
  canCall: boolean;
  canManage: boolean;
  transferTargets: TransferTarget[];
}

export function TicketCard({ ticket, now, canCall, canManage, transferTargets }: TicketCardProps) {
  const t = useTranslations('queue');
  const enumLabel = useEnumLabel();

  const showWait =
    ticket.status === TicketStatus.WAITING || ticket.status === TicketStatus.CALLED;
  const waitMinutes = Math.max(
    0,
    Math.floor((now - new Date(ticket.createdAt).getTime()) / 60_000),
  );
  const waitLabel =
    waitMinutes < 60
      ? t('wait.min', { min: waitMinutes })
      : t('wait.hourMin', { h: Math.floor(waitMinutes / 60), min: waitMinutes % 60 });

  const isCalled = ticket.status === TicketStatus.CALLED;
  const inactive = ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.SKIPPED;

  return (
    <div
      className={cn(
        'rounded-lg border border-l-4 bg-card p-3 shadow-sm transition-colors',
        STATUS_ACCENT[ticket.status],
        isCalled && 'bg-primary/[0.04] ring-1 ring-primary/30',
        inactive && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xl font-bold tabular-nums leading-none tracking-tight">
            {ticket.ticketNumber}
          </span>
          {ticket.priority !== TicketPriority.NORMAL ? (
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none',
                PRIORITY_CHIP[ticket.priority],
              )}
            >
              {enumLabel('priority', ticket.priority)}
            </span>
          ) : null}
        </div>
        <TicketActions
          ticket={ticket}
          canCall={canCall}
          canManage={canManage}
          transferTargets={transferTargets}
        />
      </div>

      <p className="mt-1.5 truncate text-sm font-medium text-foreground">{ticket.patientName}</p>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <StatusBadge status={ticket.status} group="ticket" />
        {ticket.roomNumber ? (
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <DoorOpen className="h-3.5 w-3.5" />
            {t('roomNumber', { number: ticket.roomNumber })}
          </span>
        ) : showWait ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {t('card.waiting', { time: waitLabel })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
