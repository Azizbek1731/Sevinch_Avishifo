'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { QueueTicketPayload } from '@avishifo/shared';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDoctors, useTransferTicket } from '../hooks';

export interface TransferTicketDialogProps {
  ticket: QueueTicketPayload | null;
  onOpenChange: (open: boolean) => void;
}

export function TransferTicketDialog({ ticket, onOpenChange }: TransferTicketDialogProps) {
  const t = useTranslations('reception');
  const tc = useTranslations('common');
  const [targetDoctorUserId, setTargetDoctorUserId] = useState('');
  const { data: doctors, isLoading } = useDoctors();
  const transferMutation = useTransferTicket();

  const close = (next: boolean) => {
    if (!next) setTargetDoctorUserId('');
    onOpenChange(next);
  };

  const submit = () => {
    if (!ticket || !targetDoctorUserId) return;
    transferMutation.mutate(
      { ticketId: ticket.id, targetDoctorUserId },
      { onSuccess: () => close(false) },
    );
  };

  const options = (doctors ?? []).filter((d) => d.id !== ticket?.doctorUserId);

  return (
    <Dialog open={ticket !== null} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('transferDialog.title')}</DialogTitle>
          <DialogDescription>
            {ticket
              ? t('transferDialog.subtitle', {
                  ticket: ticket.ticketNumber,
                  patient: ticket.patientName,
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>{t('transferDialog.targetDoctor')}</Label>
          <Select value={targetDoctorUserId} onValueChange={setTargetDoctorUserId}>
            <SelectTrigger>
              <SelectValue placeholder={isLoading ? tc('loading') : tc('select')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.fullName}
                  {d.specialty ? ` — ${d.specialty}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!targetDoctorUserId || transferMutation.isPending}
            onClick={submit}
          >
            {t('transferDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
