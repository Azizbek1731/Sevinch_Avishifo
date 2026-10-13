'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { format, parseISO } from 'date-fns';
import { CalendarIcon, ChevronsUpDown } from 'lucide-react';
import { createAppointmentSchema, type CreateAppointmentInput } from '@avishifo/shared';
import { formatTime, formatTz, tashkentToUtcIso, todayTashkent } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PatientCombobox } from '@/features/billing/components/patient-combobox';
import type { PatientBrief } from '@/features/billing/api';
import { localizedName, type Appointment, type FreeSlot } from '../api';
import {
  useActiveServices,
  useCreateAppointment,
  useDoctors,
  useSlots,
  useUpdateAppointment,
} from '../hooks';

export interface AppointmentPrefill {
  doctorUserId?: string;
  date?: string;
  time?: string;
}

interface AppointmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Required in edit mode (reschedule). */
  appointment?: Appointment | null;
  prefill?: AppointmentPrefill | null;
}

export function AppointmentFormDialog({
  open,
  onOpenChange,
  mode,
  appointment,
  prefill,
}: AppointmentFormDialogProps) {
  const t = useTranslations('appointments');
  const locale = useLocale();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const [dateStr, setDateStr] = useState<string>(todayTashkent());
  const [selectedPatient, setSelectedPatient] = useState<PatientBrief | null>(null);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const form = useForm<CreateAppointmentInput>({
    resolver: zodResolver(createAppointmentSchema),
    defaultValues: { patientId: '', branchId: '', doctorUserId: '', startAt: '', serviceIds: [] },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && appointment) {
      form.reset({
        patientId: appointment.patientId,
        branchId: appointment.branchId,
        doctorUserId: appointment.doctorUserId,
        startAt: appointment.startAt,
        serviceIds: appointment.services.map((s) => s.serviceId),
        note: appointment.note ?? undefined,
      });
      setDateStr(formatTz(appointment.startAt, 'yyyy-MM-dd'));
      setSelectedPatient(null);
    } else {
      const date = prefill?.date ?? todayTashkent();
      form.reset({
        patientId: '',
        branchId: activeBranchId ?? '',
        doctorUserId: prefill?.doctorUserId ?? '',
        startAt: prefill?.time ? tashkentToUtcIso(date, prefill.time) : '',
        serviceIds: [],
        note: undefined,
      });
      setDateStr(date);
      setSelectedPatient(null);
    }
  }, [open, mode, appointment, prefill, activeBranchId, form]);

  const doctorUserId = form.watch('doctorUserId');
  const serviceIds = form.watch('serviceIds') ?? [];
  const startAt = form.watch('startAt');

  const { data: doctors } = useDoctors();
  const { data: services } = useActiveServices();
  const { data: slots, isLoading: slotsLoading } = useSlots(
    {
      doctorUserId,
      date: dateStr,
      branchId: activeBranchId ?? '',
      serviceId: serviceIds[0],
    },
    open && Boolean(doctorUserId) && Boolean(activeBranchId) && Boolean(dateStr),
  );

  /** Free slots + the currently selected time (kept visible when rescheduling). */
  const slotChips = useMemo<FreeSlot[]>(() => {
    const list = slots ?? [];
    if (startAt && !list.some((s) => s.startAt === startAt)) {
      return [...list, { startAt, endAt: startAt }].sort((a, b) =>
        a.startAt.localeCompare(b.startAt),
      );
    }
    return list;
  }, [slots, startAt]);

  const createMutation = useCreateAppointment();
  const updateMutation = useUpdateAppointment();
  const pending = createMutation.isPending || updateMutation.isPending;

  const close = () => onOpenChange(false);

  const onSubmit = form.handleSubmit((values) => {
    if (mode === 'edit' && appointment) {
      updateMutation.mutate(
        {
          id: appointment.id,
          body: {
            startAt: values.startAt,
            serviceIds: values.serviceIds,
            note: values.note?.trim() ? values.note : undefined,
          },
        },
        { onSuccess: close },
      );
    } else {
      createMutation.mutate(
        { ...values, note: values.note?.trim() ? values.note : undefined },
        { onSuccess: close },
      );
    }
  });

  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {/* Patient */}
          <div className="space-y-2">
            <Label>{t('form.patient')}</Label>
            {mode === 'edit' ? (
              <Button
                type="button"
                variant="outline"
                disabled
                className="w-full justify-start font-normal"
              >
                <span className="truncate">{appointment?.patient.fullName}</span>
              </Button>
            ) : (
              <PatientCombobox
                value={selectedPatient}
                allowCreate
                onChange={(patient) => {
                  setSelectedPatient(patient);
                  form.setValue('patientId', patient?.id ?? '', { shouldValidate: true });
                }}
              />
            )}
            {errors.patientId ? (
              <p className="text-sm font-medium text-destructive">{t('form.required')}</p>
            ) : null}
          </div>

          {/* Doctor */}
          <div className="space-y-2">
            <Label>{t('form.doctor')}</Label>
            <Select
              value={doctorUserId || undefined}
              disabled={mode === 'edit'}
              onValueChange={(v) => {
                form.setValue('doctorUserId', v, { shouldValidate: true });
                form.setValue('startAt', '');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('form.selectDoctor')} />
              </SelectTrigger>
              <SelectContent>
                {(doctors ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.doctorUserId ? (
              <p className="text-sm font-medium text-destructive">{t('form.required')}</p>
            ) : null}
          </div>

          {/* Services */}
          <div className="space-y-2">
            <Label>{t('form.services')}</Label>
            <Popover open={servicesOpen} onOpenChange={setServicesOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  className={cn(
                    'w-full justify-between font-normal',
                    serviceIds.length === 0 && 'text-muted-foreground',
                  )}
                >
                  <span className="truncate">
                    {serviceIds.length > 0
                      ? t('form.servicesSelected', { count: serviceIds.length })
                      : t('form.selectServices')}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
                  {(services ?? []).map((s) => {
                    const checked = serviceIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            const next = c
                              ? [...serviceIds, s.id]
                              : serviceIds.filter((id) => id !== s.id);
                            form.setValue('serviceIds', next);
                          }}
                        />
                        <span className="flex-1 truncate">{localizedName(s.name, locale)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t('form.minutes', { count: s.durationMin })}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Date + slots */}
          <div className="space-y-2">
            <Label>{t('form.date')}</Label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start font-normal"
                >
                  <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                  {formatTz(tashkentToUtcIso(dateStr, '12:00'), 'dd.MM.yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={parseISO(dateStr)}
                  onSelect={(d) => {
                    if (d) {
                      setDateStr(format(d, 'yyyy-MM-dd'));
                      form.setValue('startAt', '');
                    }
                    setDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>{t('form.time')}</Label>
            {!doctorUserId ? (
              <p className="text-sm text-muted-foreground">{t('form.slotsHint')}</p>
            ) : slotsLoading ? (
              <p className="text-sm text-muted-foreground">{t('form.loadingSlots')}</p>
            ) : slotChips.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('form.noSlots')}</p>
            ) : (
              <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5">
                {slotChips.map((s) => {
                  const selected = startAt === s.startAt;
                  return (
                    <button
                      key={s.startAt}
                      type="button"
                      className={cn(
                        'rounded-md border px-2 py-1.5 text-sm transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'hover:bg-accent',
                      )}
                      onClick={() => form.setValue('startAt', s.startAt, { shouldValidate: true })}
                    >
                      {formatTime(s.startAt)}
                    </button>
                  );
                })}
              </div>
            )}
            {errors.startAt ? (
              <p className="text-sm font-medium text-destructive">{t('form.required')}</p>
            ) : null}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="appointment-note">{t('form.note')}</Label>
            <Textarea
              id="appointment-note"
              rows={2}
              placeholder={t('form.notePlaceholder')}
              {...form.register('note')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
