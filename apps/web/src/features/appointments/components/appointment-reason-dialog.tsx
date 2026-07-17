'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppointmentStatus } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Appointment } from '../api';
import { useChangeAppointmentStatus } from '../hooks';

interface AppointmentReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  status: AppointmentStatus;
}

/** Reason-required status change: CANCELLED or NO_SHOW. */
export function AppointmentReasonDialog({
  open,
  onOpenChange,
  appointment,
  status,
}: AppointmentReasonDialogProps) {
  const t = useTranslations('appointments');
  const [reason, setReason] = useState('');
  const mutation = useChangeAppointmentStatus();

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!appointment) return null;

  const title =
    status === AppointmentStatus.CANCELLED ? t('reason.cancelTitle') : t('reason.noShowTitle');

  const submit = () => {
    mutation.mutate(
      { id: appointment.id, body: { status, reason: reason.trim() } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{appointment.patient.fullName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="status-reason">{t('reason.label')}</Label>
          <Textarea
            id="status-reason"
            rows={3}
            value={reason}
            placeholder={t('reason.placeholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length === 0 || mutation.isPending}
            onClick={submit}
          >
            {t('reason.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
