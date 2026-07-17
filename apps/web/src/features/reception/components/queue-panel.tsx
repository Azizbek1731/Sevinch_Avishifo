'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRightLeft, Flag, ListX, MoreVertical, Users } from 'lucide-react';
import {
  TicketPriority,
  TicketStatus,
  type QueueTicketPayload,
} from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { useQueueSnapshot, useSetTicketPriority, useSkipTicket } from '../hooks';
import { TransferTicketDialog } from './transfer-ticket-dialog';

const ACTIVE_STATUSES: readonly TicketStatus[] = [
  TicketStatus.WAITING,
  TicketStatus.CALLED,
  TicketStatus.IN_ROOM,
];

const PRIORITY_CLASSES: Record<TicketPriority, string> = {
  [TicketPriority.NORMAL]: '',
  [TicketPriority.PRIORITY]:
    'border-transparent bg-warning/15 text-warning-foreground dark:text-warning',
  [TicketPriority.EMERGENCY]: 'border-transparent bg-destructive/10 text-destructive',
};

interface DoctorGroup {
  key: string;
  doctorName: string | null;
  active: QueueTicketPayload[];
  doneCount: number;
}

function groupByDoctor(tickets: QueueTicketPayload[]): DoctorGroup[] {
  const map = new Map<string, DoctorGroup>();
  for (const ticket of tickets) {
    const key = ticket.doctorUserId ?? 'none';
    let group = map.get(key);
    if (!group) {
      group = { key, doctorName: ticket.doctorName, active: [], doneCount: 0 };
      map.set(key, group);
    }
    if (ACTIVE_STATUSES.includes(ticket.status)) group.active.push(ticket);
    else group.doneCount += 1;
  }
  for (const group of map.values()) {
    group.active.sort((a, b) => a.position - b.position);
  }
  return [...map.values()].sort((a, b) =>
    (a.doctorName ?? '￿').localeCompare(b.doctorName ?? '￿'),
  );
}

export function QueuePanel() {
  const t = useTranslations('reception');
  const tc = useTranslations('common');
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canManage = Boolean(permissions?.includes('queue.manage'));
  const canSkip = Boolean(permissions?.includes('queue.call'));

  const { data: tickets, isLoading } = useQueueSnapshot();
  const priorityMutation = useSetTicketPriority();
  const skipMutation = useSkipTicket();
  const [transferTicket, setTransferTicket] = useState<QueueTicketPayload | null>(null);
  const [skipTicketTarget, setSkipTicketTarget] = useState<QueueTicketPayload | null>(null);

  const groups = useMemo(() => groupByDoctor(tickets ?? []), [tickets]);
  const hasActive = groups.some((g) => g.active.length > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('queue.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !hasActive ? (
          <EmptyState icon={Users} title={t('queue.empty')} description={t('queue.emptyHint')} />
        ) : (
          groups
            .filter((g) => g.active.length > 0)
            .map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {group.doctorName ?? t('queue.noDoctor')}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t('queue.groupCounts', {
                      waiting: group.active.filter((x) => x.status === TicketStatus.WAITING)
                        .length,
                      done: group.doneCount,
                    })}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {group.active.map((ticket) => (
                    <li
                      key={ticket.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="shrink-0 font-mono text-base font-bold tabular-nums">
                          {ticket.ticketNumber}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{ticket.patientName}</p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <StatusBadge
                              status={ticket.status}
                              label={t(`ticketStatuses.${ticket.status}`)}
                            />
                            {ticket.priority !== TicketPriority.NORMAL ? (
                              <Badge
                                variant="outline"
                                className={cn('font-medium', PRIORITY_CLASSES[ticket.priority])}
                              >
                                {t(`priorities.${ticket.priority}`)}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {canManage || canSkip ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              aria-label={tc('actions')}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canManage ? (
                              <>
                                <DropdownMenuLabel>{t('queue.priority')}</DropdownMenuLabel>
                                {(
                                  [
                                    TicketPriority.NORMAL,
                                    TicketPriority.PRIORITY,
                                    TicketPriority.EMERGENCY,
                                  ] as const
                                ).map((p) => (
                                  <DropdownMenuItem
                                    key={p}
                                    disabled={ticket.priority === p || priorityMutation.isPending}
                                    onSelect={() =>
                                      priorityMutation.mutate({ ticketId: ticket.id, priority: p })
                                    }
                                  >
                                    <Flag className="mr-2 h-4 w-4" />
                                    {t(`priorities.${p}`)}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => setTransferTicket(ticket)}>
                                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                                  {t('queue.transfer')}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                            {canSkip ? (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setSkipTicketTarget(ticket)}
                              >
                                <ListX className="mr-2 h-4 w-4" />
                                {t('queue.skip')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
        )}
      </CardContent>

      <TransferTicketDialog
        ticket={transferTicket}
        onOpenChange={(open) => {
          if (!open) setTransferTicket(null);
        }}
      />

      <ConfirmDialog
        open={skipTicketTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSkipTicketTarget(null);
        }}
        title={t('queue.skipConfirmTitle')}
        description={
          skipTicketTarget
            ? t('queue.skipConfirmDesc', {
                ticket: skipTicketTarget.ticketNumber,
                patient: skipTicketTarget.patientName,
              })
            : ''
        }
        confirmLabel={t('queue.skip')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={() => {
          if (skipTicketTarget) skipMutation.mutate(skipTicketTarget.id);
          setSkipTicketTarget(null);
        }}
      />
    </Card>
  );
}
