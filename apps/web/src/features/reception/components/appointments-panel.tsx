'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, ListPlus, XCircle } from 'lucide-react';
import { AppointmentStatus, formatPhone } from '@avishifo/shared';
import { formatTime } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { useChangeAppointmentStatus, useEnqueue, useTodayAppointments } from '../hooks';
import type { ReceptionAppointment } from '../api';
import { CancelAppointmentDialog } from './cancel-appointment-dialog';

const CANCELLABLE: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
];

export function AppointmentsPanel() {
  const t = useTranslations('reception');
  const branchId = useAuthStore((s) => s.activeBranchId);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canWrite = Boolean(permissions?.includes('appointments.write'));
  const canCancel = Boolean(permissions?.includes('appointments.cancel'));
  const canEnqueue = Boolean(permissions?.includes('queue.manage'));

  const { data: appointments, isLoading } = useTodayAppointments();
  const statusMutation = useChangeAppointmentStatus();
  const enqueueMutation = useEnqueue();
  const [cancelId, setCancelId] = useState<string | null>(null);

  const advance = (a: ReceptionAppointment, status: AppointmentStatus) =>
    statusMutation.mutate({ id: a.id, body: { status } });

  const enqueue = (a: ReceptionAppointment) => {
    if (!branchId) return;
    enqueueMutation.mutate({
      patientId: a.patientId,
      branchId,
      doctorUserId: a.doctorUserId,
      appointmentId: a.id,
      kind: 'DOCTOR',
      priority: 'NORMAL',
    });
  };

  const busy = statusMutation.isPending || enqueueMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t('appointments.title')}
          {appointments ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {appointments.length}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (appointments ?? []).length === 0 ? (
          <EmptyState icon={CalendarClock} title={t('appointments.empty')} />
        ) : (
          <ul className="space-y-2">
            {(appointments ?? []).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatTime(a.startAt)}–{formatTime(a.endAt)}
                    </span>
                    <StatusBadge status={a.status} group="appointment" />
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{a.patient.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.doctor.fullName}
                    {a.patient.phone ? ` · ${formatPhone(a.patient.phone)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {canWrite && a.status === AppointmentStatus.SCHEDULED ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => advance(a, AppointmentStatus.CONFIRMED)}
                    >
                      {t('appointments.confirm')}
                    </Button>
                  ) : null}
                  {canWrite && a.status === AppointmentStatus.CONFIRMED ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => advance(a, AppointmentStatus.CHECKED_IN)}
                    >
                      {t('appointments.checkIn')}
                    </Button>
                  ) : null}
                  {canEnqueue && a.status === AppointmentStatus.CHECKED_IN ? (
                    <Button size="sm" disabled={busy} onClick={() => enqueue(a)}>
                      <ListPlus className="mr-1 h-4 w-4" />
                      {t('appointments.enqueue')}
                    </Button>
                  ) : null}
                  {canCancel && CANCELLABLE.includes(a.status) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      aria-label={t('appointments.cancel')}
                      disabled={busy}
                      onClick={() => setCancelId(a.id)}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CancelAppointmentDialog
        appointmentId={cancelId}
        onOpenChange={(open) => {
          if (!open) setCancelId(null);
        }}
      />
    </Card>
  );
}
