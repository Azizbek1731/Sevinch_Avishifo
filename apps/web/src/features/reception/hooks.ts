'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  ChangeAppointmentStatusInput,
  CreateAppointmentInput,
  CreatePatientInput,
  EnqueueInput,
  TicketPriority,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import {
  changeAppointmentStatus,
  createPatient,
  createWalkIn,
  enqueueTicket,
  fetchDoctors,
  fetchQueueSnapshot,
  fetchTodayAppointments,
  searchPatients,
  setTicketPriority,
  skipTicket,
  transferTicket,
} from './api';

/** WS is only a change signal — polling keeps us fresh if the socket drops (spec §12). */
const POLL_MS = 15_000;

export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return (err: unknown) => {
    const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
    toast.error(tErr.has(code) ? tErr(code) : tErr('INTERNAL_ERROR'));
  };
}

export function useTodayAppointments() {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['appointments', 'today', branchId],
    queryFn: () => fetchTodayAppointments(branchId as string),
    enabled: Boolean(branchId),
    refetchInterval: POLL_MS,
  });
}

export function useQueueSnapshot() {
  const branchId = useAuthStore((s) => s.activeBranchId);
  return useQuery({
    queryKey: ['queue', 'snapshot', branchId],
    queryFn: () => fetchQueueSnapshot(branchId as string),
    enabled: Boolean(branchId),
    refetchInterval: POLL_MS,
  });
}

export function useDoctors() {
  return useQuery({
    queryKey: ['staff', 'doctors'],
    queryFn: fetchDoctors,
    staleTime: 5 * 60_000,
  });
}

export function usePatientSearch(search: string) {
  return useQuery({
    queryKey: ['patients', 'reception-search', search],
    queryFn: () => searchPatients(search),
    enabled: search.trim().length >= 2,
  });
}

export function useChangeAppointmentStatus() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeAppointmentStatusInput }) =>
      changeAppointmentStatus(id, body),
    onSuccess: () => {
      toast.success(t('appointments.statusChanged'));
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}

export function useEnqueue() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EnqueueInput) => enqueueTicket(body),
    onSuccess: () => {
      toast.success(t('queue.enqueued'));
      void qc.invalidateQueries({ queryKey: ['queue', 'snapshot'] });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}

export function useSetTicketPriority() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, priority }: { ticketId: string; priority: TicketPriority }) =>
      setTicketPriority(ticketId, priority),
    onSuccess: () => {
      toast.success(t('queue.priorityChanged'));
      void qc.invalidateQueries({ queryKey: ['queue', 'snapshot'] });
    },
    onError,
  });
}

export function useTransferTicket() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, targetDoctorUserId }: { ticketId: string; targetDoctorUserId: string }) =>
      transferTicket(ticketId, targetDoctorUserId),
    onSuccess: () => {
      toast.success(t('queue.transferred'));
      void qc.invalidateQueries({ queryKey: ['queue', 'snapshot'] });
    },
    onError,
  });
}

export function useSkipTicket() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => skipTicket(ticketId),
    onSuccess: () => {
      toast.success(t('queue.skipped'));
      void qc.invalidateQueries({ queryKey: ['queue', 'snapshot'] });
    },
    onError,
  });
}

/**
 * Fast patient registration. DUPLICATE_PATIENT (409) is NOT toasted here —
 * the dialog surfaces the candidate list with a force option instead.
 */
export function useCreatePatient() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, force }: { body: CreatePatientInput; force: boolean }) =>
      createPatient(body, force),
    onSuccess: () => {
      toast.success(t('newPatient.created'));
      void qc.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === 'DUPLICATE_PATIENT') return;
      onError(err);
    },
  });
}

export function useCreateWalkIn() {
  const t = useTranslations('reception');
  const onError = useApiErrorToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, priority }: { input: CreateAppointmentInput; priority: TicketPriority }) =>
      createWalkIn(input, priority),
    onSuccess: () => {
      toast.success(t('walkIn.created'));
      void qc.invalidateQueries({ queryKey: ['queue', 'snapshot'] });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError,
  });
}
