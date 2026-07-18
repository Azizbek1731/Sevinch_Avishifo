'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AppointmentStatus, formatPhone } from '@avishifo/shared';
import { formatTime, formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { localizedName, type Appointment } from '../api';
import { useChangeAppointmentStatus } from '../hooks';

const TERMINAL: readonly AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.CANCELLED,
];

interface AppointmentDetailDialogProps {
  appointment: Appointment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReschedule: (appointment: Appointment) => void;
  onRecurring: (appointment: Appointment) => void;
  /** Open the reason dialog for CANCELLED / NO_SHOW. */
  onReason: (appointment: Appointment, status: AppointmentStatus) => void;
}

export function AppointmentDetailDialog({
  appointment,
  open,
  onOpenChange,
  onReschedule,
  onRecurring,
  onReason,
}: AppointmentDetailDialogProps) {
  const t = useTranslations('appointments');
  const locale = useLocale();
  const user = useAuthStore((s) => s.user);
  const statusMutation = useChangeAppointmentStatus();

  if (!appointment) return null;
  const a = appointment;

  const canWrite = user?.permissions.includes('appointments.write') ?? false;
  const canCancel = user?.permissions.includes('appointments.cancel') ?? false;
  const terminal = TERMINAL.includes(a.status);

  const changeStatus = (status: AppointmentStatus) => {
    statusMutation.mutate(
      { id: a.id, body: { status } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('detail.title')}
            <StatusBadge status={a.status} group="appointment" />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground">{t('detail.patient')}</span>
            <span className="text-right font-medium">
              {a.patient.fullName}
              {a.patient.phone ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {formatPhone(a.patient.phone)}
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t('detail.doctor')}</span>
            <span className="font-medium">{a.doctor.fullName}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t('detail.time')}</span>
            <span className="font-medium">
              {formatTz(a.startAt, 'dd.MM.yyyy HH:mm', locale as 'uz' | 'ru' | 'en')}–
              {formatTime(a.endAt)}
            </span>
          </div>
          {a.services.length > 0 ? (
            <div className="space-y-1">
              <span className="text-muted-foreground">{t('detail.services')}</span>
              <ul className="space-y-0.5">
                {a.services.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{localizedName(s.name, locale)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t('form.minutes', { count: s.durationMin })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {a.note ? (
            <div className="space-y-1">
              <span className="text-muted-foreground">{t('detail.note')}</span>
              <p className="whitespace-pre-wrap">{a.note}</p>
            </div>
          ) : null}
          {a.cancelledReason ? (
            <div className="space-y-1">
              <span className="text-muted-foreground">{t('detail.cancelledReason')}</span>
              <p className="whitespace-pre-wrap text-destructive">{a.cancelledReason}</p>
            </div>
          ) : null}
        </div>

        {canWrite && !terminal ? (
          <>
            <Separator />
            <div className="flex flex-wrap justify-end gap-2">
              {a.status === AppointmentStatus.SCHEDULED ? (
                <Button
                  size="sm"
                  disabled={statusMutation.isPending}
                  onClick={() => changeStatus(AppointmentStatus.CONFIRMED)}
                >
                  {t('detail.confirm')}
                </Button>
              ) : null}
              {a.status === AppointmentStatus.CONFIRMED ? (
                <Button
                  size="sm"
                  disabled={statusMutation.isPending}
                  onClick={() => changeStatus(AppointmentStatus.CHECKED_IN)}
                >
                  {t('detail.checkIn')}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => onReschedule(a)}>
                {t('detail.reschedule')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRecurring(a)}>
                {t('detail.recurring')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => onReason(a, AppointmentStatus.NO_SHOW)}
              >
                {t('detail.noShow')}
              </Button>
              {canCancel ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onReason(a, AppointmentStatus.CANCELLED)}
                >
                  {t('detail.cancel')}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
