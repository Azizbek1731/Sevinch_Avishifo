'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createSurgerySchema, type CreateSurgeryInput } from '@avishifo/shared';
import { createId } from '@/lib/id';
import { localizedText } from '@/lib/localized';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { useDebouncedValue } from '@/features/doctor/hooks';
import { todayTashkent } from '@/lib/dates';
import { useApiErrorToast } from '@/features/services/hooks';
import type { ServiceRow } from '@/features/services/api';
import { surgeriesApi } from '../api';
import { useInvalidateSurgeries } from '../hooks';
import { identifySurgeryRequest, type SurgeryRequestKey } from '../request-key';
import { SurgeryCataloguePicker } from './catalogue-picker';

export function CreateSurgeryDialog({
  open,
  onOpenChange,
  admissionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admissionId?: string;
}) {
  const t = useTranslations('surgeries');
  const locale = useLocale();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [service, setService] = useState<ServiceRow | null>(null);
  const [admissionSearch, setAdmissionSearch] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');
  const admissionTerm = useDebouncedValue(admissionSearch, 300);
  const doctorTerm = useDebouncedValue(doctorSearch, 300);
  const identity = useRef<SurgeryRequestKey | null>(null);
  const invalidate = useInvalidateSurgeries();
  const onError = useApiErrorToast();
  const admissions = useQuery({
    queryKey: ['surgeries', 'admissions', branchId, admissionTerm],
    queryFn: async () => (await surgeriesApi.admissions(admissionTerm)).data,
    enabled: open,
  });
  const doctors = useQuery({
    queryKey: ['surgeries', 'doctors', branchId, doctorTerm],
    queryFn: async () => (await surgeriesApi.doctors(doctorTerm)).data,
    enabled: open,
  });
  const form = useForm<CreateSurgeryInput>({ resolver: zodResolver(createSurgerySchema) });
  useEffect(() => {
    if (open) {
      setAdmissionSearch('');
      setDoctorSearch('');
      setService(null);
      identity.current = null;
      form.reset({
        admissionId: admissionId ?? '',
        serviceId: '',
        surgeonUserId: '',
        scheduledDate: todayTashkent(),
        title: '',
        unitPrice: undefined,
        note: '',
        idempotencyKey: createId(),
      });
    }
  }, [open, admissionId, branchId, form]);
  const create = useMutation({
    mutationFn: surgeriesApi.create,
    onError,
    onSuccess: () => {
      invalidate();
      toast.success(t('created'));
      identity.current = null;
      onOpenChange(false);
    },
  });
  const submit = form.handleSubmit((values) => {
    const payload = {
      admissionId: values.admissionId,
      serviceId: values.serviceId,
      surgeonUserId: values.surgeonUserId,
      scheduledDate: values.scheduledDate,
      title: values.title?.trim() || undefined,
      unitPrice: values.unitPrice?.trim() || undefined,
      note: values.note?.trim() || undefined,
    };
    identity.current = identifySurgeryRequest(payload, identity.current);
    create.mutate({ ...payload, idempotencyKey: identity.current.key });
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('schedule')}</DialogTitle>
          <DialogDescription>{t('scheduleHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={create.isPending} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('patientAdmission')}</Label>
              {!admissionId ? (
                <Input
                  aria-label={t('searchAdmission')}
                  placeholder={t('searchAdmission')}
                  value={admissionSearch}
                  onChange={(event) => {
                    setAdmissionSearch(event.target.value);
                    form.setValue('admissionId', '');
                  }}
                />
              ) : null}
              {admissionId ? (
                <Input
                  readOnly
                  value={
                    admissions.data?.find((item) => item.id === admissionId)?.patient.fullName ??
                    t('currentAdmission')
                  }
                />
              ) : (
                <Select
                  value={form.watch('admissionId') || ''}
                  disabled={Boolean(admissionId)}
                  onValueChange={(id) => form.setValue('admissionId', id, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('select')} />
                  </SelectTrigger>
                  <SelectContent>
                    {admissions.data?.map((admission) => (
                      <SelectItem key={admission.id} value={admission.id}>
                        {admission.patient.fullName} · {admission.historyNumber}
                        {admission.ward ? ` · ${admission.ward}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('operation')}</Label>
              <SurgeryCataloguePicker
                kind="SURGERY"
                value={service}
                onChange={(next) => {
                  setService(next);
                  form.setValue('serviceId', next.id, { shouldValidate: true });
                  form.setValue('title', localizedText(next.name, locale), {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                  form.setValue('unitPrice', next.currentPrice ?? '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                }}
              />
              <p className="text-xs text-muted-foreground">{t('overrideHint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="surgery-title">{t('operationName')}</Label>
                  <Input
                    id="surgery-title"
                    maxLength={200}
                    placeholder={t('operationNamePlaceholder')}
                    disabled={!service}
                    {...form.register('title')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="surgery-fee">{t('fee')}</Label>
                  <Input
                    id="surgery-fee"
                    inputMode="decimal"
                    placeholder="0"
                    disabled={!service}
                    {...form.register('unitPrice')}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('surgeon')}</Label>
              <Input
                aria-label={t('searchSurgeon')}
                placeholder={t('searchSurgeon')}
                value={doctorSearch}
                onChange={(event) => {
                  setDoctorSearch(event.target.value);
                  form.setValue('surgeonUserId', '');
                }}
              />
              <Select
                value={form.watch('surgeonUserId') || ''}
                onValueChange={(id) => form.setValue('surgeonUserId', id, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('select')} />
                </SelectTrigger>
                <SelectContent>
                  {doctors.data?.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.fullName}
                      {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="surgery-date">{t('date')}</Label>
              <Input id="surgery-date" type="date" {...form.register('scheduledDate')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="surgery-note">{t('note')}</Label>
              <Textarea id="surgery-note" maxLength={1000} rows={2} {...form.register('note')} />
            </div>
          </fieldset>
          {admissions.isError || doctors.isError ? (
            <p className="text-sm text-destructive">{t('loadError')}</p>
          ) : null}
          {Object.keys(form.formState.errors).length ? (
            <p className="text-sm text-destructive" role="alert">
              {t('required')}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || admissions.isLoading || doctors.isLoading}
            >
              {t('schedule')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
