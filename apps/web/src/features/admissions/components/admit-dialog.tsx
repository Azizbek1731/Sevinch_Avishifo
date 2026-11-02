'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { admitPatientSchema, type AdmitPatientInput } from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { useApiErrorToast } from '@/features/services/hooks';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { patientsApi } from '@/features/patients/api';
import { admissionsApi } from '../api';

const OTHER_DOCTOR = '__other__';

function RequiredMark() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

/** Open a hospital stay: doctor, room label, card number, address — no catalog room price. */
export function AdmitDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patientId: string;
  patientName: string;
}) {
  const t = useTranslations('admissions');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [doctorChoice, setDoctorChoice] = useState('');
  const [autoHistory, setAutoHistory] = useState(true);

  const form = useForm<AdmitPatientInput>({
    resolver: zodResolver(admitPatientSchema),
    defaultValues: {
      patientId,
      department: '',
      ward: '',
      attendingDoctorUserId: undefined,
      attendingDoctorName: '',
      autoHistoryNumber: true,
      historyNumber: '',
      homeAddress: '',
      referredBy: '',
      admissionDiagnosis: '',
    },
  });

  const doctorsQuery = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: open && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });

  const patientQuery = useQuery({
    queryKey: ['patient', patientId, 'admit'],
    enabled: open && Boolean(patientId),
    queryFn: async () => (await patientsApi.getById(patientId)).data,
  });

  useEffect(() => {
    if (!open) return;
    setDoctorChoice('');
    setAutoHistory(true);
    form.reset({
      patientId,
      department: '',
      ward: '',
      attendingDoctorUserId: undefined,
      attendingDoctorName: '',
      autoHistoryNumber: true,
      historyNumber: '',
      homeAddress: patientQuery.data?.address ?? '',
      referredBy: '',
      admissionDiagnosis: '',
    });
  }, [open, patientId, form]);

  useEffect(() => {
    if (!open || !patientQuery.data) return;
    if (!form.getValues('homeAddress')) {
      form.setValue('homeAddress', patientQuery.data.address ?? '');
    }
  }, [open, patientQuery.data, form]);

  useEffect(() => {
    form.setValue('autoHistoryNumber', autoHistory, { shouldValidate: true });
    if (autoHistory) {
      form.setValue('historyNumber', '', { shouldValidate: true });
    }
  }, [autoHistory, form]);

  const admit = useMutation({
    mutationFn: (v: AdmitPatientInput) => admissionsApi.admit(v),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admissions'] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['patient-checkout'] });
      onOpenChange(false);
      toast.success(t('admitted', { number: res.data.historyNumber }));
      router.push(`/admissions/${res.data.id}`);
    },
    onError: errorToast,
  });

  const doctors = doctorsQuery.data ?? [];
  const doctorError =
    form.formState.errors.attendingDoctorUserId?.message ||
    form.formState.errors.attendingDoctorName?.message;
  const historyError = form.formState.errors.historyNumber?.message;
  const wardError = form.formState.errors.ward?.message;
  const addressError = form.formState.errors.homeAddress?.message;

  const onDoctorChange = (value: string) => {
    setDoctorChoice(value);
    if (value === OTHER_DOCTOR) {
      form.setValue('attendingDoctorUserId', undefined, { shouldValidate: true });
      form.setValue('attendingDoctorName', form.getValues('attendingDoctorName') || '', {
        shouldValidate: true,
      });
      return;
    }
    form.setValue('attendingDoctorUserId', value, { shouldValidate: true, shouldDirty: true });
    form.setValue('attendingDoctorName', '', { shouldValidate: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('admitTitle', { name: patientName })}</DialogTitle>
          <DialogDescription>{t('admitHint')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((values) => {
            const fromList = doctorChoice && doctorChoice !== OTHER_DOCTOR;
            admit.mutate({
              patientId: values.patientId,
              department: values.department?.trim() || undefined,
              ward: values.ward.trim(),
              attendingDoctorUserId: fromList ? doctorChoice : undefined,
              attendingDoctorName: fromList
                ? undefined
                : values.attendingDoctorName?.trim() || undefined,
              autoHistoryNumber: autoHistory,
              historyNumber: autoHistory ? undefined : values.historyNumber?.trim() || undefined,
              homeAddress: values.homeAddress.trim(),
              referredBy: values.referredBy?.trim() || undefined,
              admissionDiagnosis: values.admissionDiagnosis?.trim() || undefined,
            });
          })}
          className="space-y-5"
          noValidate
        >
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('fields.attendingDoctor')}
            </p>
            <div className="space-y-1.5">
              <Label>
                {t('fields.attendingDoctor')}
                <RequiredMark />
              </Label>
              <Select value={doctorChoice} onValueChange={onDoctorChange}>
                <SelectTrigger aria-invalid={Boolean(doctorError)}>
                  <SelectValue placeholder={t('fields.attendingDoctorPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.fullName}
                      {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_DOCTOR}>{t('fields.doctorOther')}</SelectItem>
                </SelectContent>
              </Select>
              {doctorChoice === OTHER_DOCTOR ? (
                <Input
                  className="mt-2"
                  placeholder={t('fields.doctorOtherPlaceholder')}
                  autoFocus
                  {...form.register('attendingDoctorName')}
                />
              ) : null}
              {doctorError ? <p className="text-xs text-destructive">{doctorError}</p> : null}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="ad-ward">
                {t('fields.roomNumber')}
                <RequiredMark />
              </Label>
              <Input
                id="ad-ward"
                placeholder={t('fields.roomNumberHint')}
                aria-invalid={Boolean(wardError)}
                {...form.register('ward')}
              />
              <p className="text-xs text-muted-foreground">{t('fields.roomNumberHelp')}</p>
              {wardError ? <p className="text-xs text-destructive">{wardError}</p> : null}
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/25 p-3 sm:col-span-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t('fields.historyNumber')}
                    {!autoHistory ? <RequiredMark /> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('fields.historyAutoHelp')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {autoHistory ? t('fields.historyAutoOn') : t('fields.historyAutoOff')}
                  </span>
                  <Switch checked={autoHistory} onCheckedChange={setAutoHistory} />
                </div>
              </div>
              {!autoHistory ? (
                <Input
                  placeholder={t('fields.historyNumberPlaceholder')}
                  aria-invalid={Boolean(historyError)}
                  {...form.register('historyNumber')}
                />
              ) : (
                <p className="rounded-md bg-background/80 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                  KT-{new Date().getFullYear()}-••••
                </p>
              )}
              {historyError ? <p className="text-xs text-destructive">{historyError}</p> : null}
            </div>
          </section>

          <div className="space-y-1.5">
            <Label htmlFor="ad-address">
              {t('fields.homeAddress')}
              <RequiredMark />
            </Label>
            <Textarea
              id="ad-address"
              rows={2}
              placeholder={t('fields.homeAddressHint')}
              aria-invalid={Boolean(addressError)}
              {...form.register('homeAddress')}
            />
            {addressError ? <p className="text-xs text-destructive">{addressError}</p> : null}
          </div>

          <section className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ad-dept">{t('fields.department')}</Label>
              <Input id="ad-dept" {...form.register('department')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ad-ref">{t('fields.referredBy')}</Label>
              <Input id="ad-ref" {...form.register('referredBy')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ad-diag">{t('fields.admissionDiagnosis')}</Label>
              <Input id="ad-diag" {...form.register('admissionDiagnosis')} />
            </div>
          </section>

          <p className="rounded-md border border-dashed bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
            {t('roomBilling.rule')}
          </p>

          <DialogFooter>
            <Button type="submit" className="w-full" disabled={admit.isPending}>
              {t('admit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
