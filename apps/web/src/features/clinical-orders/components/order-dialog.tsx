'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2, Receipt } from 'lucide-react';
import {
  createClinicalOrderSchema,
  addClinicalServicesSchema,
  formatUZS,
  fromTiyin,
  toTiyin,
  type CreateClinicalOrderInput,
  type AddClinicalServicesInput,
} from '@avishifo/shared';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PatientCombobox } from '@/features/billing/components/patient-combobox';
import { ServiceCombobox, serviceName } from '@/features/billing/components/service-combobox';
import { billingApi, type PatientBrief, type ServiceOption } from '@/features/billing/api';
import { searchServiceCatalogue } from '@/features/billing/service-catalogue';
import { useApiErrorToast } from '@/features/reception/hooks';
import { useAuthStore } from '@/stores/auth-store';
import { clinicalOrdersApi, type ClinicalKind } from '../api';
import {
  findDoctorConsultationService,
  isUziSpecialty,
  type DoctorOption,
} from '../doctor-matching';
import { useInvalidateClinicalOrders } from '../hooks';

function ServiceSelection({
  kind,
  services,
  onChange,
  excludeIds = [],
  locked = false,
  emptyHint,
}: {
  kind: ClinicalKind;
  services: ServiceOption[];
  excludeIds?: string[];
  onChange: (services: ServiceOption[]) => void;
  /** When true, doctor already owns the matched consultation row — no extra picker. */
  locked?: boolean;
  emptyHint?: string;
}) {
  const t = useTranslations('doctor.clinical');
  const locale = useLocale();
  const total = services.reduce((sum, service) => sum + toTiyin(service.currentPrice ?? '0'), 0n);
  return (
    <div className="space-y-3">
      <Label>{t('services')}</Label>
      {!locked ? (
        <ServiceCombobox
          value={null}
          kind={kind}
          excludeIds={[...excludeIds, ...services.map((service) => service.id)]}
          onChange={(service) => {
            if (!services.some((item) => item.id === service.id)) onChange([...services, service]);
          }}
        />
      ) : null}
      <ul className="divide-y rounded-lg border">
        {services.map((service) => (
          <li key={service.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{serviceName(service, locale)}</p>
              <p className="text-muted-foreground">{service.code}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span>{service.currentPrice ? formatUZS(service.currentPrice) : '—'}</span>
              {!locked ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('removeService')}
                  onClick={() => onChange(services.filter((item) => item.id !== service.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
        {!services.length ? (
          <li className="p-4 text-sm text-muted-foreground">
            {emptyHint ?? t('chooseServices')}
          </li>
        ) : null}
      </ul>
      <div className="flex justify-between rounded-lg bg-muted/40 p-3">
        <span>{t('total')}</span>
        <strong className="tabular-nums">{formatUZS(fromTiyin(total))}</strong>
      </div>
      <p className="text-xs text-muted-foreground">{t('priceHint')}</p>
    </div>
  );
}

export function ClinicalOrderDialog({
  open,
  onOpenChange,
  kind,
  patient: fixedPatient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ClinicalKind;
  patient?: PatientBrief | null;
}) {
  const t = useTranslations('doctor.clinical');
  const tc = useTranslations('common');
  const branchId = useAuthStore((s) => s.activeBranchId);
  const userId = useAuthStore((s) => s.user?.id);
  const [patient, setPatient] = useState<PatientBrief | null>(fixedPatient ?? null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const identity = useRef<{ fingerprint: string; key: string } | null>(null);
  const locale = useLocale();
  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId, userId],
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
    enabled: open && Boolean(branchId),
  });
  const doctorOptions = (doctors.data ?? []).filter((doctor) =>
    kind === 'ULTRASOUND' ? isUziSpecialty(doctor.specialty) : true,
  );
  const invalidate = useInvalidateClinicalOrders();
  const onError = useApiErrorToast();
  const form = useForm<CreateClinicalOrderInput>({
    resolver: zodResolver(createClinicalOrderSchema),
  });
  const applyServices = (next: ServiceOption[]) => {
    setServices(next);
    form.setValue(
      'serviceIds',
      next.map((service) => service.id),
      { shouldValidate: true },
    );
  };
  const selectDoctor = async (doctorId: string) => {
    form.setValue('doctorUserId', doctorId, { shouldValidate: true });
    if (kind !== 'CONSULTATION') return;
    const doctor = doctorOptions.find((item) => item.id === doctorId) as DoctorOption | undefined;
    if (!doctor) {
      applyServices([]);
      return;
    }
    try {
      const catalogue = await searchServiceCatalogue(billingApi.searchServices, doctor.fullName, {
        kind: 'CONSULTATION',
      });
      const match = findDoctorConsultationService(catalogue, doctor, locale);
      applyServices(match ? [match] : []);
      if (!match) toast.error(t('doctorServiceMissing'));
    } catch {
      applyServices([]);
      toast.error(t('doctorServiceMissing'));
    }
  };
  useEffect(() => {
    if (!open) return;
    setPatient(fixedPatient ?? null);
    setServices([]);
    identity.current = null;
    form.reset({
      patientId: fixedPatient?.id ?? '',
      branchId: branchId ?? '',
      doctorUserId: '',
      kind,
      serviceIds: [],
      idempotencyKey: createId(),
      note: '',
    });
  }, [open, kind, branchId, fixedPatient, form]);
  const create = useMutation({
    mutationFn: (values: CreateClinicalOrderInput) => clinicalOrdersApi.create(values),
    onError,
    onSuccess: () => {
      toast.success(t('sent'));
      invalidate();
      identity.current = null;
      onOpenChange(false);
    },
  });
  const submit = form.handleSubmit((values) => {
    const payload = {
      ...values,
      note: values.note?.trim() || undefined,
      idempotencyKey: undefined,
    };
    const fingerprint = JSON.stringify(payload);
    if (identity.current?.fingerprint !== fingerprint)
      identity.current = { fingerprint, key: createId() };
    create.mutate({ ...values, note: payload.note, idempotencyKey: identity.current.key });
  });
  const consultationLocked = kind === 'CONSULTATION';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(kind === 'ULTRASOUND' ? 'newUltrasound' : 'newConsultation')}
          </DialogTitle>
          <DialogDescription>
            {t(kind === 'CONSULTATION' ? 'consultationHandoff' : 'handoff')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={create.isPending} className="space-y-5">
            <div className="space-y-2">
              <Label>{tc('patient')}</Label>
              <PatientCombobox
                value={patient}
                allowCreate
                onChange={(next) => {
                  setPatient(next);
                  form.setValue('patientId', next?.id ?? '', { shouldValidate: true });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('doctor')}</Label>
              <Select
                value={form.watch('doctorUserId') || ''}
                disabled={doctors.isLoading || doctors.isError || !doctorOptions.length}
                onValueChange={(id) => void selectDoctor(id)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={doctors.isLoading ? tc('loading') : tc('select')} />
                </SelectTrigger>
                <SelectContent>
                  {doctorOptions.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.fullName}
                      {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {doctors.isError ? (
                <div role="alert" className="text-sm text-destructive">
                  {t('loadError')}
                  <Button type="button" variant="link" onClick={() => void doctors.refetch()}>
                    {t('refresh')}
                  </Button>
                </div>
              ) : null}
              {doctors.isSuccess && !doctorOptions.length ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {t(kind === 'ULTRASOUND' ? 'noUziDoctors' : 'noDoctors')}
                </p>
              ) : null}
            </div>
            <ServiceSelection
              kind={kind}
              services={services}
              locked={consultationLocked}
              emptyHint={
                consultationLocked
                  ? form.watch('doctorUserId')
                    ? t('doctorServiceMissing')
                    : t('pickDoctorFirst')
                  : undefined
              }
              onChange={applyServices}
            />
            <div className="space-y-2">
              <Label htmlFor="clinical-note">{t('note')}</Label>
              <Textarea id="clinical-note" maxLength={2000} rows={2} {...form.register('note')} />
            </div>
          </fieldset>
          {Object.keys(form.formState.errors).length ? (
            <p role="alert" className="text-sm text-destructive">
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
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !branchId}>
              <Receipt className="mr-2 h-4 w-4" />
              {t('sendToCashier')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExtraClinicalServicesDialog({
  open,
  onOpenChange,
  orderId,
  existingServiceIds = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  existingServiceIds?: string[];
}) {
  const t = useTranslations('doctor.clinical');
  const tc = useTranslations('common');
  const [services, setServices] = useState<ServiceOption[]>([]);
  const identity = useRef<{ fingerprint: string; key: string } | null>(null);
  const onError = useApiErrorToast();
  const invalidate = useInvalidateClinicalOrders();
  useEffect(() => {
    if (open) {
      setServices([]);
      identity.current = null;
    }
  }, [open]);
  const create = useMutation({
    mutationFn: (body: AddClinicalServicesInput) => clinicalOrdersApi.addServices(orderId, body),
    onError,
    onSuccess: (result) => {
      toast.success(t('extraSent', { number: result.data.number }));
      invalidate();
      identity.current = null;
      onOpenChange(false);
    },
  });
  const submit = () => {
    const serviceIds = services.map((service) => service.id);
    const fingerprint = JSON.stringify({ orderId, serviceIds });
    if (identity.current?.fingerprint !== fingerprint)
      identity.current = { fingerprint, key: createId() };
    const parsed = addClinicalServicesSchema.safeParse({
      serviceIds,
      idempotencyKey: identity.current.key,
    });
    if (parsed.success) create.mutate(parsed.data);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('extraServices')}</DialogTitle>
          <DialogDescription>{t('extraHint')}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={create.isPending}>
          <ServiceSelection
            kind="ULTRASOUND"
            excludeIds={existingServiceIds}
            services={services}
            onChange={setServices}
          />
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button disabled={!services.length || create.isPending} onClick={submit}>
            {t('sendToCashier')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
