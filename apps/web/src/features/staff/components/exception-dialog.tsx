'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ScheduleExceptionType,
  addScheduleExceptionSchema,
  type AddScheduleExceptionInput,
} from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { todayTashkent } from '@/lib/dates';
import { emptyToUndefined, staffApi } from '../api';
import { useApiErrorToast } from '../hooks';

const EXCEPTION_TYPES: ScheduleExceptionType[] = [
  ScheduleExceptionType.VACATION,
  ScheduleExceptionType.SICK_LEAVE,
  ScheduleExceptionType.DAY_OFF,
  ScheduleExceptionType.CUSTOM_HOURS,
];

export interface ExceptionDialogProps {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExceptionDialog({ userId, open, onOpenChange }: ExceptionDialogProps) {
  const t = useTranslations('staff');
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();

  const form = useForm<AddScheduleExceptionInput>({
    resolver: zodResolver(addScheduleExceptionSchema),
    defaultValues: {
      type: ScheduleExceptionType.VACATION,
      dateFrom: todayTashkent(),
      dateTo: todayTashkent(),
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      type: ScheduleExceptionType.VACATION,
      dateFrom: todayTashkent(),
      dateTo: todayTashkent(),
    });
  }, [open]);

  const mutation = useMutation({
    mutationFn: (values: AddScheduleExceptionInput) => staffApi.addException(userId, values),
    onSuccess: () => {
      toast.success(t('schedule.exceptions.added'));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'schedule', userId] });
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
  const type = form.watch('type');
  const isCustomHours = type === ScheduleExceptionType.CUSTOM_HOURS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('schedule.exceptions.addTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>{t('schedule.exceptions.type')}</Label>
            <Select
              value={type}
              onValueChange={(v) =>
                form.setValue('type', v as ScheduleExceptionType, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCEPTION_TYPES.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    {enumLabel('exception', ty)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="exception-date-from">{t('schedule.exceptions.dateFrom')}</Label>
              <Input id="exception-date-from" type="date" {...form.register('dateFrom')} />
              {form.formState.errors.dateFrom ? (
                <p className="text-sm text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="exception-date-to">{t('schedule.exceptions.dateTo')}</Label>
              <Input id="exception-date-to" type="date" {...form.register('dateTo')} />
              {form.formState.errors.dateTo ? (
                <p className="text-sm text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
          </div>

          {isCustomHours ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="exception-start">{t('schedule.exceptions.startTime')}</Label>
                <Input
                  id="exception-start"
                  type="time"
                  {...form.register('startTime', { setValueAs: emptyToUndefined })}
                />
                {form.formState.errors.startTime ? (
                  <p className="text-sm text-destructive">{t('form.required')}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="exception-end">{t('schedule.exceptions.endTime')}</Label>
                <Input
                  id="exception-end"
                  type="time"
                  {...form.register('endTime', { setValueAs: emptyToUndefined })}
                />
                {form.formState.errors.endTime ? (
                  <p className="text-sm text-destructive">{t('form.required')}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="exception-note">{t('schedule.exceptions.note')}</Label>
            <Textarea
              id="exception-note"
              rows={2}
              {...form.register('note', { setValueAs: emptyToUndefined })}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
