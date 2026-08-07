'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Locale,
  clinicSettingsSchema,
  updateClinicSchema,
  type ClinicSettingsInput,
  type UpdateClinicInput,
  phoneWireValueOptional,
} from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/dates';
import { emptyToUndefined, settingsApi } from '../api';
import { useApiErrorToast, useHasPermission } from '../hooks';

const LOCALE_VALUES: Locale[] = [Locale.UZ, Locale.UZ_CYRL, Locale.RU, Locale.EN];


function ClinicProfileForm() {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useHasPermission('clinic.settings.write');

  const clinicQuery = useQuery({
    queryKey: ['clinic'],
    queryFn: () => settingsApi.getClinic(),
  });
  const clinic = clinicQuery.data?.data;

  const form = useForm<UpdateClinicInput>({
    resolver: zodResolver(updateClinicSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (!clinic) return;
    form.reset({
      name: clinic.name,
      legalName: clinic.legalName ?? undefined,
      taxId: clinic.taxId ?? undefined,
      phone: clinic.phone ?? undefined,
      email: clinic.email ?? undefined,
      address: clinic.address ?? undefined,
      defaultLocale: clinic.defaultLocale,
      smsSenderName: clinic.smsSenderName ?? undefined,
    });
  }, [clinic]);

  const mutation = useMutation({
    mutationFn: (values: UpdateClinicInput) => settingsApi.updateClinic(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinic'] });
      toast.success(t('clinic.saved'));
    },
    onError: errorToast,
  });

  if (clinicQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  // Fall back to the loaded clinic's locale so the picker shows the current
  // value even before the form field binds — an unset value must not block save.
  const defaultLocale = form.watch('defaultLocale') ?? clinic?.defaultLocale;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{t('clinic.profileTitle')}</CardTitle>
            <CardDescription>{t('clinic.profileDesc')}</CardDescription>
          </div>
          {clinic?.subscription ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('clinic.plan')}:</span>
              <span className="font-medium">{clinic.subscription.plan.name}</span>
              <StatusBadge status={clinic.subscription.status} />
              {clinic.subscription.endsAt ? (
                <span className="text-muted-foreground">
                  {t('clinic.planUntil', { date: formatDate(clinic.subscription.endsAt) })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={form.handleSubmit(
            (values) => mutation.mutate(values),
            () => toast.error(t('clinic.saveInvalid')),
          )}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="clinic-name">{t('clinic.name')}</Label>
            <Input id="clinic-name" autoComplete="off" {...form.register('name')} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-legal">{t('clinic.legalName')}</Label>
            <Input
              id="clinic-legal"
              autoComplete="off"
              {...form.register('legalName', { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-taxid">{t('clinic.taxId')}</Label>
            <Input
              id="clinic-taxid"
              autoComplete="off"
              {...form.register('taxId', { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-phone">{t('clinic.phone')}</Label>
            <PhoneInput
              id="clinic-phone"
              autoComplete="off"
              {...form.register('phone', { setValueAs: phoneWireValueOptional})}
            />
            {form.formState.errors.phone ? (
              <p className="text-sm text-destructive">{t('form.invalidPhone')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-email">{t('clinic.email')}</Label>
            <Input
              id="clinic-email"
              type="email"
              autoComplete="off"
              {...form.register('email', { setValueAs: emptyToUndefined })}
            />
            {form.formState.errors.email ? (
              <p className="text-sm text-destructive">{t('form.invalidEmail')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-address">{t('clinic.address')}</Label>
            <Input
              id="clinic-address"
              autoComplete="off"
              {...form.register('address', { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('clinic.defaultLocale')}</Label>
            <Select
              value={defaultLocale ?? undefined}
              onValueChange={(v) => form.setValue('defaultLocale', v as Locale, { shouldDirty: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('form.select')} />
              </SelectTrigger>
              <SelectContent>
                {LOCALE_VALUES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`locales.${l.replace('-', '_')}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="clinic-sms-sender">{t('clinic.smsSenderName')}</Label>
            <Input
              id="clinic-sms-sender"
              autoComplete="off"
              {...form.register('smsSenderName', { setValueAs: emptyToUndefined })}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={!canWrite || mutation.isPending}>
              {t('form.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ClinicSettingsForm() {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useHasPermission('clinic.settings.write');

  const settingsQuery = useQuery({
    queryKey: ['clinic', 'settings'],
    queryFn: () => settingsApi.getSettings(),
  });
  const settings = settingsQuery.data?.data;

  const form = useForm<ClinicSettingsInput>({
    resolver: zodResolver(clinicSettingsSchema),
    defaultValues: {},
  });

  useEffect(() => {
    if (!settings) return;
    form.reset({
      invoiceNumberFormat: settings.invoiceNumberFormat,
      vatRate: settings.vatRate,
      visitLockHours: settings.visitLockHours,
      doctorPatientAccess: settings.doctorPatientAccess,
      queueAutoRecallPosition: settings.queueAutoRecallPosition,
    });
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (values: ClinicSettingsInput) => settingsApi.updateSettings(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinic', 'settings'] });
      toast.success(t('clinic.saved'));
    },
    onError: errorToast,
  });

  /** Empty number input → undefined (all settings fields are optional). */
  const numberOrUndefined = (v: unknown): number | undefined => {
    if (v === '' || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  };

  if (settingsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  const doctorPatientAccess = form.watch('doctorPatientAccess') ?? settings?.doctorPatientAccess;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('clinic.settingsTitle')}</CardTitle>
        <CardDescription>{t('clinic.settingsDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={form.handleSubmit(
            (values) => mutation.mutate(values),
            () => toast.error(t('clinic.saveInvalid')),
          )}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="set-invoice-format">{t('clinic.invoiceNumberFormat')}</Label>
            <Input
              id="set-invoice-format"
              autoComplete="off"
              placeholder="INV-{YYYY}-{NNNNNN}"
              {...form.register('invoiceNumberFormat', { setValueAs: emptyToUndefined })}
            />
            <p className="text-xs text-muted-foreground">{t('clinic.invoiceFormatHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-vat">{t('clinic.vatRate')}</Label>
            <Input
              id="set-vat"
              type="number"
              min={0}
              max={100}
              step="0.01"
              {...form.register('vatRate', { setValueAs: numberOrUndefined })}
            />
            {form.formState.errors.vatRate ? (
              <p className="text-sm text-destructive">{t('form.invalidNumber')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-visit-lock">{t('clinic.visitLockHours')}</Label>
            <Input
              id="set-visit-lock"
              type="number"
              min={0}
              step={1}
              {...form.register('visitLockHours', { setValueAs: numberOrUndefined })}
            />
            <p className="text-xs text-muted-foreground">{t('clinic.visitLockHint')}</p>
          </div>
          <div className="space-y-2">
            <Label>{t('clinic.doctorPatientAccess')}</Label>
            <Select
              value={doctorPatientAccess ?? undefined}
              onValueChange={(v) =>
                form.setValue('doctorPatientAccess', v as 'own' | 'branch', { shouldDirty: true })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t('form.select')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own">{t('clinic.accessOwn')}</SelectItem>
                <SelectItem value="branch">{t('clinic.accessBranch')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-recall">{t('clinic.queueAutoRecallPosition')}</Label>
            <Input
              id="set-recall"
              type="number"
              min={0}
              step={1}
              {...form.register('queueAutoRecallPosition', { setValueAs: numberOrUndefined })}
            />
            <p className="text-xs text-muted-foreground">{t('clinic.recallHint')}</p>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={!canWrite || mutation.isPending}>
              {t('form.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ClinicTab() {
  return (
    <div className="space-y-6">
      <ClinicProfileForm />
      <ClinicSettingsForm />
    </div>
  );
}
