'use client';

import { useState } from 'react';
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
import { useChangeAppointmentStatus } from '../hooks';

export interface CancelAppointmentDialogProps {
  appointmentId: string | null;
  onOpenChange: (open: boolean) => void;
}

/** Cancel with a mandatory reason (business rule for CANCELLED). */
export function CancelAppointmentDialog({
  appointmentId,
  onOpenChange,
}: CancelAppointmentDialogProps) {
  const t = useTranslations('reception');
  const tc = useTranslations('common');
  const [reason, setReason] = useState('');
  const statusMutation = useChangeAppointmentStatus();

  const close = (next: boolean) => {
    if (!next) setReason('');
    onOpenChange(next);
  };

  const submit = () => {
    if (!appointmentId || reason.trim().length === 0) return;
    statusMutation.mutate(
      {
        id: appointmentId,
        body: { status: AppointmentStatus.CANCELLED, reason: reason.trim() },
      },
      { onSuccess: () => close(false) },
    );
  };

  return (
    <Dialog open={appointmentId !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cancelDialog.title')}</DialogTitle>
          <DialogDescription>{t('cancelDialog.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">{t('cancelDialog.reason')}</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('cancelDialog.reasonPlaceholder')}
            rows={3}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {tc('back')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={reason.trim().length === 0 || statusMutation.isPending}
            onClick={submit}
          >
            {t('cancelDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
