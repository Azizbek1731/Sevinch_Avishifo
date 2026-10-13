'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, ListOrdered, PhoneCall, Users } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { TicketStatus, type QueueTicketPayload } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useSocket, useSocketEvent } from '@/hooks/use-socket';
import { Link, useRouter } from '@/i18n/routing';
import { SINGLE_CLINIC_MODE } from '@/lib/deployment';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import type { VisitListItem } from '../api';
import {
  useCallNext,
  useCreateVisit,
  useMyVisits,
  useQueues,
  useRooms,
  useTicketAction,
} from '../hooks';
import { ClinicalWorklist } from '@/features/clinical-orders/components/worklist';
import { PatientSummary } from './patient-summary';

const NO_ROOM = 'none';
const roomStorageKey = (branchId: string) => `avishifo.doctor.room.${branchId}`;

function TicketRow({
  ticket,
  onAction,
  onFinish,
  busy,
  canAct,
}: {
  ticket: QueueTicketPayload;
  onAction: (ticketId: string, action: 'start' | 'skip' | 'recall') => void;
  onFinish: (ticket: QueueTicketPayload) => void;
  busy: boolean;
  canAct: boolean;
}) {
  const t = useTranslations('doctor');
  const enumLabel = useEnumLabel();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-lg font-bold tabular-nums">{ticket.ticketNumber}</span>
        <div className="min-w-0">
          <p className="truncate font-medium">{ticket.patientName}</p>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={ticket.status} group="ticket" />
            {ticket.priority !== 'NORMAL' ? (
              <StatusBadge
                status={ticket.priority === 'EMERGENCY' ? 'CANCELLED' : 'IN_QUEUE'}
                label={enumLabel('priority', ticket.priority)}
              />
            ) : null}
            {ticket.roomNumber ? (
              <span className="text-xs text-muted-foreground">
                {t('roomShort', { room: ticket.roomNumber })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {canAct ? (
        <div className="flex items-center gap-1.5">
          {ticket.status === TicketStatus.CALLED ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => onAction(ticket.id, 'start')}>
                {t('start')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAction(ticket.id, 'recall')}
              >
                {t('recall')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onAction(ticket.id, 'skip')}
              >
                {t('skip')}
              </Button>
            </>
          ) : null}
          {ticket.status === TicketStatus.IN_ROOM ? (
            <Button size="sm" disabled={busy} onClick={() => onFinish(ticket)}>
              {t('finish')}
            </Button>
          ) : null}
          {ticket.status === TicketStatus.SKIPPED ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction(ticket.id, 'recall')}
            >
              {t('recall')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function DoctorCockpit() {
  const t = useTranslations('doctor');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const branchId = useAuthStore((s) => s.activeBranchId);

  const canCall = user?.permissions.includes('queue.call') ?? false;
  const canWriteVisits = user?.permissions.includes('visits.write') ?? false;

  const { data: queues, isLoading } = useQueues(SINGLE_CLINIC_MODE ? null : branchId);
  const { data: rooms } = useRooms(SINGLE_CLINIC_MODE ? null : branchId);
  const callNext = useCallNext();
  const ticketAction = useTicketAction();
  const createVisit = useCreateVisit();

  const [roomId, setRoomId] = useState<string>(NO_ROOM);
  const [visitsPage, setVisitsPage] = useState(1);
  const myVisits = useMyVisits(user?.id ?? null, visitsPage);

  // Remembered room per branch
  useEffect(() => {
    if (!branchId) return;
    const saved = window.localStorage.getItem(roomStorageKey(branchId));
    setRoomId(saved ?? NO_ROOM);
  }, [branchId]);

  const selectRoom = (value: string) => {
    setRoomId(value);
    if (branchId) window.localStorage.setItem(roomStorageKey(branchId), value);
  };

  // Live updates: join the branch queue room, invalidate on any ticket event.
  const { socket, connected } = useSocket();
  useEffect(() => {
    if (socket && connected && branchId) socket.emit('queue.subscribe', { branchId });
  }, [socket, connected, branchId]);
  const invalidateQueues = () => {
    void queryClient.invalidateQueries({ queryKey: ['queues'] });
  };
  useSocketEvent('queue.ticket.created', invalidateQueues);
  useSocketEvent('queue.ticket.updated', invalidateQueues);
  useSocketEvent('queue.ticket.called', invalidateQueues);

  const myQueue = useMemo(
    () => queues?.find((q) => q.kind === 'DOCTOR' && q.doctorUserId === user?.id) ?? null,
    [queues, user?.id],
  );

  const tickets = myQueue?.tickets ?? [];
  const activeTickets = tickets.filter(
    (tk) =>
      tk.status === TicketStatus.WAITING ||
      tk.status === TicketStatus.CALLED ||
      tk.status === TicketStatus.IN_ROOM,
  );
  const skippedTickets = tickets.filter((tk) => tk.status === TicketStatus.SKIPPED);
  const currentTicket =
    tickets.find((tk) => tk.status === TicketStatus.IN_ROOM) ??
    tickets.find((tk) => tk.status === TicketStatus.CALLED) ??
    null;

  const waitingCount = tickets.filter((tk) => tk.status === TicketStatus.WAITING).length;
  const doneCount = tickets.filter((tk) => tk.status === TicketStatus.DONE).length;
  const inRoomCount = tickets.filter((tk) => tk.status === TicketStatus.IN_ROOM).length;

  const busy = ticketAction.isPending || createVisit.isPending || callNext.isPending;

  const handleAction = (ticketId: string, action: 'start' | 'skip' | 'recall') => {
    ticketAction.mutate({ ticketId, action });
  };

  const handleFinish = (ticket: QueueTicketPayload) => {
    ticketAction.mutate(
      { ticketId: ticket.id, action: 'finish' },
      {
        onSuccess: () => {
          if (!canWriteVisits) return;
          createVisit.mutate(ticket.id, {
            onSuccess: (res) => {
              router.push(`/doctor/visits/${res.data.id}`);
            },
          });
        },
      },
    );
  };

  const handleCallNext = () => {
    if (!myQueue) return;
    callNext.mutate({ queueId: myQueue.id, roomId: roomId === NO_ROOM ? null : roomId });
  };

  const visitColumns: ColumnDef<VisitListItem>[] = [
    {
      accessorKey: 'startedAt',
      header: tCommon('date'),
      cell: ({ row }) => (row.original.startedAt ? formatTz(row.original.startedAt) : '—'),
    },
    {
      accessorKey: 'patient',
      header: tCommon('patient'),
      cell: ({ row }) => (
        <span>
          {row.original.patient.fullName}{' '}
          <span className="text-muted-foreground">{row.original.patient.mrn}</span>
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: tCommon('status'),
      cell: ({ row }) => <StatusBadge status={row.original.status} group="visit" />,
    },
    {
      id: 'actions',
      header: tCommon('actions'),
      cell: ({ row }) => (
        <Link
          href={`/doctor/visits/${row.original.id}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t('openVisit')}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <ClinicalWorklist />

      {!SINGLE_CLINIC_MODE ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard title={t('waiting')} value={waitingCount} icon={Users} />
            <StatCard title={t('inRoom')} value={inRoomCount} icon={PhoneCall} />
            <StatCard title={t('doneToday')} value={doneCount} icon={CheckCircle2} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* LEFT: my queue */}
            <Card>
              <CardHeader className="space-y-3 pb-3">
                <CardTitle className="text-lg">{t('myQueue')}</CardTitle>
                {canCall ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={roomId} onValueChange={selectRoom}>
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder={t('room')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ROOM}>{t('noRoom')}</SelectItem>
                        {(rooms ?? []).map((room) => (
                          <SelectItem key={room.id} value={room.id}>
                            {t('roomShort', { room: room.number })}
                            {room.name ? ` — ${room.name}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="lg"
                      className="flex-1 text-base font-semibold"
                      disabled={!myQueue || busy || waitingCount === 0}
                      onClick={handleCallNext}
                    >
                      <PhoneCall className="mr-2 h-5 w-5" />
                      {t('callNext')}
                    </Button>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : !myQueue || activeTickets.length === 0 ? (
                  <EmptyState
                    icon={ListOrdered}
                    title={t('queueEmpty')}
                    description={t('queueEmptyDesc')}
                  />
                ) : (
                  <ul className="space-y-2">
                    {activeTickets.map((ticket) => (
                      <TicketRow
                        key={ticket.id}
                        ticket={ticket}
                        onAction={handleAction}
                        onFinish={handleFinish}
                        busy={busy}
                        canAct={canCall}
                      />
                    ))}
                  </ul>
                )}
                {skippedTickets.length > 0 ? (
                  <div>
                    <p className="mb-2 text-sm font-medium text-muted-foreground">{t('skipped')}</p>
                    <ul className="space-y-2">
                      {skippedTickets.map((ticket) => (
                        <TicketRow
                          key={ticket.id}
                          ticket={ticket}
                          onAction={handleAction}
                          onFinish={handleFinish}
                          busy={busy}
                          canAct={canCall}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* RIGHT: current patient summary */}
            <PatientSummary ticket={currentTicket} />
          </div>
        </>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('myVisits')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={visitColumns}
            data={myVisits.data?.data ?? []}
            meta={myVisits.data?.meta}
            onPageChange={setVisitsPage}
            isLoading={myVisits.isLoading}
            emptyText={t('noVisits')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
