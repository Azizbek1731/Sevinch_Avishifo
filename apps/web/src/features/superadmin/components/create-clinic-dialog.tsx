'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  createClinicWithOwnerSchema,
  normalizePhone,
  type CreateClinicWithOwnerInput,
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
import { Separator } from '@/components/ui/separator';
import { superadminApi } from '../api';
import { useApiErrorToast } from '../hooks';

/** "" → undefined for optional string fields. */
function emptyToUndefined(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Normalize a required phone field on submit; keep raw input when invalid so zod reports it. */
function normalizeRequiredPhone(v: unknown): string {
  if (typeof v !== 'string') return '';
  return normalizePhone(v) ?? v;
}

/** Normalize an optional phone field; "" → undefined. */
function normalizeOptionalPhone(v: unknown): string | undefined {
  const s = emptyToUndefined(v);
  if (s === undefined) return undefined;
  return normalizePhone(s) ?? s;
}

const EMPTY_VALUES: CreateClinicWithOwnerInput = {
  clinic: { name: '' },
  owner: { fullName: '', phone: '', password: '' },
};

export interface CreateClinicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateClinicDialog({ open, onOpenChange }: CreateClinicDialogProps) {
  const t = useTranslations('superadmin');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();

  const form = useForm<CreateClinicWithOwnerInput>({
    resolver: zodResolver(createClinicWithOwnerSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY_VALUES);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (values: CreateClinicWithOwnerInput) => superadminApi.createClinic(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'clinics'] });
      toast.success(t('clinics.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('clinics.createDialog.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <p className="text-sm font-semibold text-muted-foreground">
            {t('clinics.createDialog.clinicSection')}
          </p>
          <div className="space-y-2">
            <Label htmlFor="clinic-name">{t('clinics.createDialog.name')}</Label>
            <Input id="clinic-name" autoComplete="off" {...form.register('clinic.name')} />
            {errors.clinic?.name ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-legal-name">{t('clinics.createDialog.legalName')}</Label>
            <Input
              id="clinic-legal-name"
              autoComplete="off"
              {...form.register('clinic.legalName', { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="clinic-phone">{t('clinics.createDialog.phone')}</Label>
              <Input
                id="clinic-phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="+998 90 123 45 67"
                {...form.register('clinic.phone', { setValueAs: normalizeOptionalPhone })}
              />
              {errors.clinic?.phone ? (
                <p className="text-sm text-destructive">{t('form.invalidPhone')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="clinic-email">{t('clinics.createDialog.email')}</Label>
              <Input
                id="clinic-email"
                type="email"
                autoComplete="off"
                {...form.register('clinic.email', { setValueAs: emptyToUndefined })}
              />
              {errors.clinic?.email ? (
                <p className="text-sm text-destructive">{t('form.invalidEmail')}</p>
              ) : null}
            </div>
          </div>

          <Separator />
          <p className="text-sm font-semibold text-muted-foreground">
            {t('clinics.createDialog.ownerSection')}
          </p>
          <div className="space-y-2">
            <Label htmlFor="owner-full-name">{t('clinics.createDialog.ownerFullName')}</Label>
            <Input id="owner-full-name" autoComplete="off" {...form.register('owner.fullName')} />
            {errors.owner?.fullName ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="owner-phone">{t('clinics.createDialog.ownerPhone')}</Label>
              <Input
                id="owner-phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="+998 90 123 45 67"
                {...form.register('owner.phone', { setValueAs: normalizeRequiredPhone })}
              />
              {errors.owner?.phone ? (
                <p className="text-sm text-destructive">{t('form.invalidPhone')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-email">{t('clinics.createDialog.ownerEmail')}</Label>
              <Input
                id="owner-email"
                type="email"
                autoComplete="off"
                {...form.register('owner.email', { setValueAs: emptyToUndefined })}
              />
              {errors.owner?.email ? (
                <p className="text-sm text-destructive">{t('form.invalidEmail')}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner-password">{t('clinics.createDialog.password')}</Label>
            <Input
              id="owner-password"
              type="password"
              autoComplete="new-password"
              {...form.register('owner.password')}
            />
            {errors.owner?.password ? (
              <p className="text-sm text-destructive">{t('form.passwordMin')}</p>
            ) : null}
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
