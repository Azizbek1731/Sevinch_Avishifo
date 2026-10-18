'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  createOrderSchema,
  formatUZS,
  fromTiyin,
  toTiyin,
  type CreateOrderInput,
} from '@avishifo/shared';
import { todayTashkent } from '@/lib/dates';
import { createId } from '@/lib/id';
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

/** One order and its cashier invoice are saved together. */
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
  const [startDate, setStartDate] = useState(todayTashkent);
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setService(null);
    setSchedule('DAILY');
    setDays('5');
    setPerDay('1');
    setStartDate(todayTashkent());
    requestIdentity.current = null;
  }, [open]);

  const create = useMutation({
    mutationFn: (payload: CreateOrderInput) => admissionsApi.createOrder(admissionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      for (const key of [
        'charges',
        'invoices',
        'patients',
        'admissions',
        'admission-discharge-check',
      ])
        void queryClient.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
      toast.success(t('orderAdded'));
    },
    onError: errorToast,
  });

  const once = schedule === 'ONCE';
  const parsed = createOrderSchema.safeParse({
    serviceId: service?.id,
    schedule,
    startDate,
    timesPlanned: once ? 1 : Number(days),
    timesPerDay: once ? 1 : Number(perDay),
  });
  const totalDoses = parsed.success ? parsed.data.timesPlanned * parsed.data.timesPerDay : 0;
  const totalPrice =
    service?.currentPrice != null && totalDoses > 0
      ? fromTiyin(toTiyin(service.currentPrice) * BigInt(totalDoses))
      : null;

  const submit = () => {
    if (!parsed.success || create.isPending) return;
    const fingerprint = JSON.stringify(parsed.data);
    if (requestIdentity.current?.fingerprint !== fingerprint)
      requestIdentity.current = { fingerprint, key: createId() };
    create.mutate({ ...parsed.data, idempotencyKey: requestIdentity.current.key });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!create.isPending) onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addOrder')}</DialogTitle>
          <DialogDescription>{t('directBilling.hint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('fields.service')}</Label>
            <ServiceCombobox
              excludeSurgery
              disabled={create.isPending}
              value={service}
              onChange={setService}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('fields.schedule')}</Label>
            <Select
              disabled={create.isPending}
              value={schedule}
              onValueChange={(v) => setSchedule(v as typeof schedule)}
            >
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

          <div className="grid grid-cols-3 items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-start">{t('fields.startDate')}</Label>
              <Input
                id="o-start"
                type="date"
                value={startDate}
                disabled={create.isPending}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            {/* Treatment DAYS — the ward says "5 kun davomida", so the field
                counts days; kunora spreads those days over a longer stay. */}
            <div className="space-y-1.5">
              <Label htmlFor="o-days">{t('fields.durationDays')}</Label>
              <Input
                id="o-days"
                inputMode="numeric"
                value={once ? '1' : days}
                disabled={once || create.isPending}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('fields.timesPerDay')}</Label>
              <Select
                value={once ? '1' : perDay}
                onValueChange={setPerDay}
                disabled={once || create.isPending}
              >
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
          {totalPrice !== null ? (
            <div className="flex items-center justify-between rounded-md bg-primary/5 p-3 text-sm">
              <span>{t('directBilling.total')}</span>
              <strong className="tabular-nums">{formatUZS(totalPrice)}</strong>
            </div>
          ) : service ? (
            <p role="alert" className="text-sm text-destructive">
              {t('directBilling.checkFields')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            disabled={!parsed.success || totalPrice === null || create.isPending}
            onClick={submit}
          >
            {t('directBilling.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
