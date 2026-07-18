'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock, DoorOpen } from 'lucide-react';
import {
  TicketPriority,
  TicketStatus,
  type QueueTicketPayload,
} from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { cn } from '@/lib/utils';
import { TicketActions, type TransferTarget } from './ticket-actions';

/** Brief: WAITING gray, CALLED amber (pulse), IN_ROOM blue, DONE green, SKIPPED red. */
const STATUS_BORDER: Record<TicketStatus, string> = {
  [TicketStatus.WAITING]: 'border-l-slate-300 dark:border-l-slate-600',
  [TicketStatus.CALLED]: 'border-l-amber-500',
  [TicketStatus.IN_ROOM]: 'border-l-sky-500',
  [TicketStatus.DONE]: 'border-l-emerald-500',
  [TicketStatus.SKIPPED]: 'border-l-red-500',
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

  const inactive = ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.SKIPPED;

  return (
    <div
      className={cn(
        'rounded-md border border-l-4 bg-card p-3 shadow-sm',
        STATUS_BORDER[ticket.status],
        ticket.status === TicketStatus.CALLED && 'animate-pulse',
        inactive && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none">{ticket.ticketNumber}</span>
        <div className="flex items-center gap-1">
          {ticket.priority !== TicketPriority.NORMAL ? (
            <Badge
              variant={ticket.priority === TicketPriority.EMERGENCY ? 'destructive' : 'secondary'}
              className="text-[10px]"
            >
              {enumLabel('priority', ticket.priority)}
            </Badge>
          ) : null}
          <TicketActions
            ticket={ticket}
            canCall={canCall}
            canManage={canManage}
            transferTargets={transferTargets}
          />
        </div>
      </div>
      <p className="mt-1.5 truncate text-sm font-medium">{ticket.patientName}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusBadge status={ticket.status} group="ticket" />
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {ticket.roomNumber ? (
            <>
              <DoorOpen className="h-3.5 w-3.5" />
              {t('roomNumber', { number: ticket.roomNumber })}
            </>
          ) : showWait ? (
            <>
              <Clock className="h-3.5 w-3.5" />
              {waitLabel}
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
