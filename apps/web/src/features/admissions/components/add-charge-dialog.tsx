'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { addChargeSchema, fromTiyin, toTiyin, type AddChargeInput } from '@avishifo/shared';
import { todayTashkent } from '@/lib/dates';
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
import { ServiceCombobox } from '@/features/billing/components/service-combobox';
import type { ServiceOption } from '@/features/billing/api';
import { useApiErrorToast } from '@/features/services/hooks';
import { chargesApi } from '../api';

/** Records a service/cost and sends its invoice to the cashier atomically. */
export function AddChargeDialog({
  open,
  onOpenChange,
  patientId,
  admissionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  admissionId?: string;
}) {
  const t = useTranslations('charges');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const errorToast = useApiErrorToast();
  const [mode, setMode] = useState<'catalog' | 'manual'>('catalog');
  const [service, setService] = useState<ServiceOption | null>(null);
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(null);
  const form = useForm<AddChargeInput>({
    resolver: zodResolver(addChargeSchema),
    defaultValues: { patientId, admissionId, date: todayTashkent(), quantity: 1 },
  });

  useEffect(() => {
    if (open) {
      form.reset({ patientId, admissionId, date: todayTashkent(), quantity: 1 });
      setService(null);
      setMode('catalog');
      requestIdentity.current = null;
    }
  }, [open, patientId, admissionId, form]);

  const add = useMutation({
    mutationFn: (value: AddChargeInput) => chargesApi.add(value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['charges', patientId] });
      void qc.invalidateQueries({ queryKey: ['admission'] });
      void qc.invalidateQueries({ queryKey: ['patients'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['admission-discharge-check'] });
      toast.success(t('add.saved'));
      onOpenChange(false);
    },
    onError: errorToast,
  });
  const switchMode = (value: 'catalog' | 'manual') => {
    setMode(value);
    setService(null);
    form.reset({ patientId, admissionId, date: form.getValues('date'), quantity: 1 });
  };
  const submit = (value: AddChargeInput) => {
    if (add.isPending) return;
    const payload = {
      ...value,
      unitPrice: value.unitPrice !== undefined ? fromTiyin(toTiyin(value.unitPrice)) : undefined,
    };
    const fingerprint = JSON.stringify(payload);
    if (requestIdentity.current?.fingerprint !== fingerprint)
      requestIdentity.current = { fingerprint, key: crypto.randomUUID() };
    add.mutate({ ...payload, idempotencyKey: requestIdentity.current.key });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!add.isPending) onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('add.title')}</DialogTitle>
          <DialogDescription>{t('add.hint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <fieldset disabled={add.isPending} className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'catalog' ? 'default' : 'outline'}
                onClick={() => switchMode('catalog')}
              >
                {t('add.catalog')}
              </Button>
              <Button
                type="button"
                variant={mode === 'manual' ? 'default' : 'outline'}
                onClick={() => switchMode('manual')}
              >
                {t('add.manual')}
              </Button>
            </div>
            {mode === 'catalog' ? (
              <div className="space-y-2">
                <Label>{t('add.service')}</Label>
                <ServiceCombobox
                  excludeSurgery
                  disabled={add.isPending}
                  value={service}
                  onChange={(value) => {
                    setService(value);
                    form.setValue('serviceId', value.id);
                    form.setValue('unitPrice', value.currentPrice ?? undefined);
                  }}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="charge-title">{t('add.name')}</Label>
                <Input id="charge-title" maxLength={200} required {...form.register('title')} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="charge-date">{t('add.date')}</Label>
                <Input id="charge-date" type="date" required {...form.register('date')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="charge-qty">{t('add.quantity')}</Label>
                <Input
                  id="charge-qty"
                  type="number"
                  min={1}
                  max={999}
                  required
                  {...form.register('quantity', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="charge-price">{t('add.price')}</Label>
                <Input
                  id="charge-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  {...form.register('unitPrice')}
                />
              </div>
            </div>
            {Object.values(form.formState.errors).map((error, i) => (
              <p key={i} role="alert" className="text-sm text-destructive">
                {error.message}
              </p>
            ))}
          </fieldset>
          <DialogFooter>
            <Button
              disabled={add.isPending}
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {tc('cancel')}
            </Button>
            <Button disabled={add.isPending || (mode === 'catalog' && !service)} type="submit">
              {t('add.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
