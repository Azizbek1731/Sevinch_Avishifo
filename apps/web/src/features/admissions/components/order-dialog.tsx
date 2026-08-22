'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
import { ServiceCombobox } from '@/features/billing/components/service-combobox';
import type { ServiceOption } from '@/features/billing/api';
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi } from '../api';

const SCHEDULES = ['DAILY', 'EVERY_OTHER_DAY', 'ONCE'] as const;

/** Ordering a service onto the treatment sheet. */
export function OrderDialog({
  open,
  onOpenChange,
  admissionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  admissionId: string;
}) {
  const t = useTranslations('admissions');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();

  const [service, setService] = useState<ServiceOption | null>(null);
  const [schedule, setSchedule] = useState<(typeof SCHEDULES)[number]>('DAILY');
  const [days, setDays] = useState('5');
  const [perDay, setPerDay] = useState('1');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!open) return;
    setService(null);
    setSchedule('DAILY');
    setDays('5');
    setPerDay('1');
    setStartDate(new Date().toISOString().slice(0, 10));
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      admissionsApi.createOrder(admissionId, {
        serviceId: service?.id as string,
        schedule,
        startDate,
        timesPlanned: Number(days),
        timesPerDay: Number(perDay),
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      onOpenChange(false);
      toast.success(t('orderAdded'));
    },
    onError: errorToast,
  });

  const once = schedule === 'ONCE';
  const totalDoses = once ? 1 : (Number(days) || 0) * (Number(perDay) || 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addOrder')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('fields.service')}</Label>
            <ServiceCombobox value={service} onChange={setService} />
          </div>

          <div className="space-y-1.5">
            <Label>{t('fields.schedule')}</Label>
            <Select value={schedule} onValueChange={(v) => setSchedule(v as typeof schedule)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`sheet.schedules.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-start">{t('fields.startDate')}</Label>
              <Input id="o-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            {/* Treatment DAYS — the ward says "5 kun davomida", so the field
                counts days; kunora spreads those days over a longer stay. */}
            <div className="space-y-1.5">
              <Label htmlFor="o-days">{t('fields.durationDays')}</Label>
              <Input
                id="o-days"
                inputMode="numeric"
                value={once ? '1' : days}
                disabled={once}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fields.timesPerDay')}</Label>
              <Select value={once ? '1' : perDay} onValueChange={setPerDay} disabled={once}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['1', '2', '3', '4', '5', '6'].map((n) => (
                    <SelectItem key={n} value={n}>
                      {t('fields.perDayOption', { count: Number(n) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {totalDoses > 1 ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              {t('fields.orderSummary', {
                total: totalDoses,
                days: Number(days) || 0,
                perDay: Number(perDay) || 1,
              })}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            disabled={!service || create.isPending}
            onClick={() => create.mutate()}
          >
            {t('addOrder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
