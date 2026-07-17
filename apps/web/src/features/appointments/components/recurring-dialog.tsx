'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { createRecurringAppointmentSchema } from '@avishifo/shared';
import type { z } from 'zod';
import { formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Appointment } from '../api';
import { useCreateRecurring } from '../hooks';

const recurringFieldsSchema = createRecurringAppointmentSchema.pick({
  sessionsCount: true,
  intervalDays: true,
});
type RecurringFields = z.infer<typeof recurringFieldsSchema>;

interface RecurringDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Base appointment: the course repeats its doctor/patient/services/time. */
  appointment: Appointment | null;
}

export function RecurringDialog({ open, onOpenChange, appointment }: RecurringDialogProps) {
  const t = useTranslations('appointments');
  const locale = useLocale();
  const mutation = useCreateRecurring();

  const form = useForm<RecurringFields>({
    resolver: zodResolver(recurringFieldsSchema),
    defaultValues: { sessionsCount: 10, intervalDays: 1 },
  });

  useEffect(() => {
    if (open) form.reset({ sessionsCount: 10, intervalDays: 1 });
  }, [open, form]);

  if (!appointment) return null;
  const a = appointment;

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(
      {
        patientId: a.patientId,
        branchId: a.branchId,
        doctorUserId: a.doctorUserId,
        startAt: a.startAt,
        serviceIds: a.services.map((s) => s.serviceId),
        note: a.note ?? undefined,
        sessionsCount: values.sessionsCount,
        intervalDays: values.intervalDays,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  });

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('recurring.title')}</DialogTitle>
          <DialogDescription>
            {a.patient.fullName} · {a.doctor.fullName} ·{' '}
            {formatTz(a.startAt, 'dd.MM.yyyy HH:mm', locale as 'uz' | 'ru' | 'en')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">{t('recurring.description')}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sessions-count">{t('recurring.sessionsCount')}</Label>
              <Input
                id="sessions-count"
                type="number"
                min={2}
                max={50}
                {...form.register('sessionsCount', { valueAsNumber: true })}
              />
              {errors.sessionsCount ? (
                <p className="text-sm font-medium text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval-days">{t('recurring.intervalDays')}</Label>
              <Input
                id="interval-days"
                type="number"
                min={1}
                max={30}
                {...form.register('intervalDays', { valueAsNumber: true })}
              />
              {errors.intervalDays ? (
                <p className="text-sm font-medium text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('recurring.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
