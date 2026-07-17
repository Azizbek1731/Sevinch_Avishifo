'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ChangeAppointmentStatusInput,
  CreateAppointmentInput,
  CreateRecurringAppointmentInput,
  UpdateAppointmentInput,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { useSocketEvent } from '@/hooks/use-socket';
import { appointmentsApi, type AppointmentListParams, type SlotsParams } from './api';

const FIVE_MINUTES = 5 * 60_000;

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Maps ApiError codes to localized toast messages. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return (err: unknown) => {
    if (err instanceof ApiError) toast.error(tErr(err.code as never));
    else toast.error(tErr('INTERNAL_ERROR'));
  };
}

export function useAppointments(params: AppointmentListParams, enabled: boolean) {
  return useQuery({
    queryKey: ['appointments', params],
    queryFn: () => appointmentsApi.list(params),
    enabled,
  });
}

/** WS live refresh: `appointment.updated` → invalidate the calendar cache. */
export function useAppointmentsLive(): void {
  const queryClient = useQueryClient();
  useSocketEvent('appointment.updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
  });
}

export function useDoctors() {
  return useQuery({
    queryKey: ['users', { role: 'DOCTOR' }],
    queryFn: appointmentsApi.doctors,
    staleTime: FIVE_MINUTES,
  });
}

export function useActiveServices() {
  return useQuery({
    queryKey: ['services', { isActive: true }],
    queryFn: appointmentsApi.services,
    staleTime: FIVE_MINUTES,
  });
}

export function useSlots(params: SlotsParams, enabled: boolean) {
  return useQuery({
    queryKey: ['appointments', 'slots', params],
    queryFn: () => appointmentsApi.slots(params),
    enabled,
  });
}

export function usePatientSearch(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['patients', 'appointment-search', search],
    queryFn: () => appointmentsApi.searchPatients(search),
    enabled: enabled && search.trim().length >= 2,
  });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  const t = useTranslations('appointments');
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: (body: CreateAppointmentInput) => appointmentsApi.create(body),
    onSuccess: () => {
      toast.success(t('toasts.created'));
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient();
  const t = useTranslations('appointments');
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAppointmentInput }) =>
      appointmentsApi.update(id, body),
    onSuccess: () => {
      toast.success(t('toasts.updated'));
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}

export function useChangeAppointmentStatus() {
  const queryClient = useQueryClient();
  const t = useTranslations('appointments');
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeAppointmentStatusInput }) =>
      appointmentsApi.changeStatus(id, body),
    onSuccess: () => {
      toast.success(t('toasts.statusChanged'));
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}

export function useCreateRecurring() {
  const queryClient = useQueryClient();
  const t = useTranslations('appointments');
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: (body: CreateRecurringAppointmentInput) => appointmentsApi.createRecurring(body),
    onSuccess: (result) => {
      toast.success(
        t('recurring.result', { created: result.created.length, skipped: result.skipped.length }),
      );
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}
