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
  const [times, setTimes] = useState('5');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!open) return;
    setService(null);
    setSchedule('DAILY');
    setTimes('5');
    setStartDate(new Date().toISOString().slice(0, 10));
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      admissionsApi.createOrder(admissionId, {
        serviceId: service?.id as string,
        schedule,
        startDate,
        timesPlanned: Number(times),
      } as never),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      onOpenChange(false);
      toast.success(t('orderAdded'));
    },
    onError: errorToast,
  });

  const once = schedule === 'ONCE';

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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-start">{t('fields.startDate')}</Label>
              <Input id="o-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            {/* Counted in administrations, not calendar days — "10 times, every
                other day" is 20 days, and the ward means the ten. */}
            <div className="space-y-1.5">
              <Label htmlFor="o-times">{t('fields.times')}</Label>
              <Input
                id="o-times"
                inputMode="numeric"
                value={once ? '1' : times}
                disabled={once}
                onChange={(e) => setTimes(e.target.value)}
              />
            </div>
          </div>
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
