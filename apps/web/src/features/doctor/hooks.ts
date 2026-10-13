'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type {
  AddDiagnosisInput,
  AddPrescriptionInput,
  ReplacePrescriptionsInput,
  AddReferralInput,
  AmendVisitInput,
  UpdateVisitInput,
  UpsertVitalsInput,
  VisitTemplateUpsertInput,
} from '@avishifo/shared';
import { ApiError } from '@/lib/api-client';
import { todayTashkent } from '@/lib/dates';
import { doctorApi } from './api';

// ------------------------------------------------------------ utilities

/** Toast an ApiError with its localized message from the `errors` namespace. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return (err: unknown) => {
    if (err instanceof ApiError) toast.error(tErr.has(err.code) ? tErr(err.code) : err.message);
    else toast.error(tErr('INTERNAL_ERROR' as never));
  };
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ------------------------------------------------------------ queries

export function useQueues(branchId: string | null) {
  const date = todayTashkent();
  return useQuery({
    queryKey: ['queues', { branchId, date }],
    queryFn: () => doctorApi.getQueues(branchId as string, date),
    enabled: !!branchId,
    refetchInterval: 15_000, // graceful degradation if WS drops
    select: (res) => res.data,
  });
}

export function useRooms(branchId: string | null) {
  return useQuery({
    queryKey: ['rooms', { branchId }],
    queryFn: () => doctorApi.listRooms(branchId as string),
    enabled: !!branchId,
    select: (res) => res.data,
  });
}

export function usePatientCard(patientId: string | null) {
  return useQuery({
    queryKey: ['patients', patientId],
    queryFn: () => doctorApi.getPatient(patientId as string),
    enabled: !!patientId,
    select: (res) => res.data,
  });
}

export function usePatientLastVisits(patientId: string | null) {
  return useQuery({
    queryKey: ['visits', { patientId, limit: 5 }],
    queryFn: () => doctorApi.listVisits({ patientId: patientId as string, page: 1, limit: 5 }),
    enabled: !!patientId,
    select: (res) => res.data,
  });
}

export function useMyVisits(doctorUserId: string | null, page: number) {
  return useQuery({
    queryKey: ['visits', { doctorUserId, page }],
    queryFn: () => doctorApi.listVisits({ doctorUserId: doctorUserId as string, page, limit: 10 }),
    enabled: !!doctorUserId,
  });
}

export function useVisit(visitId: string) {
  return useQuery({
    queryKey: ['visits', visitId],
    queryFn: () => doctorApi.getVisit(visitId),
    select: (res) => res.data,
  });
}

export function useVisitPrint(visitId: string) {
  return useQuery({
    queryKey: ['visits', visitId, 'print'],
    queryFn: () => doctorApi.getPrintPayload(visitId),
    select: (res) => res.data,
  });
}

export function useIcd10Search(search: string) {
  const debounced = useDebouncedValue(search.trim());
  return useQuery({
    queryKey: ['icd10', { search: debounced }],
    queryFn: () => doctorApi.searchIcd10(debounced),
    enabled: debounced.length >= 1,
    select: (res) => res.data,
    placeholderData: (prev) => prev,
  });
}

export function useDrugSearch(search: string) {
  const debounced = useDebouncedValue(search.trim());
  return useQuery({
    queryKey: ['drugs', { search: debounced }],
    queryFn: () => doctorApi.searchDrugs(debounced),
    enabled: debounced.length >= 1,
    select: (res) => res.data,
    placeholderData: (prev) => prev,
  });
}

export function useLabTests(enabled: boolean) {
  return useQuery({
    queryKey: ['lab-tests', { limit: 100 }],
    queryFn: () => doctorApi.listLabTests(),
    enabled,
    select: (res) => res.data,
  });
}

export function useVisitTemplates() {
  return useQuery({
    queryKey: ['visit-templates'],
    queryFn: () => doctorApi.listTemplates(),
    select: (res) => res.data,
  });
}

// ------------------------------------------------------------ queue mutations

export function useCallNext() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const t = useTranslations('doctor');
  return useMutation({
    mutationFn: ({ queueId, roomId }: { queueId: string; roomId: string | null }) =>
      doctorApi.callNext(queueId, roomId),
    onSuccess: (res) => {
      toast.success(t('calledToast', { ticket: res.data.ticketNumber }));
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
    },
    onError,
  });
}

export function useTicketAction() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: ({
      ticketId,
      action,
    }: {
      ticketId: string;
      action: 'start' | 'finish' | 'skip' | 'recall';
    }) => doctorApi.ticketAction(ticketId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['queues'] });
    },
    onError,
  });
}

export function useCreateVisit() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  return useMutation({
    mutationFn: (ticketId: string) => doctorApi.createVisit(ticketId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['visits'] });
    },
    onError,
  });
}

// ------------------------------------------------------------ visit mutations

function useVisitMutation<TVars, TData>(
  visitId: string,
  mutationFn: (vars: TVars) => Promise<TData>,
  opts?: { successMessage?: string; onSuccess?: (data: TData) => void },
) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  return useMutation({
    mutationKey: ['visits', visitId],
    mutationFn,
    onSuccess: (data) => {
      if (opts?.successMessage) toast.success(opts.successMessage);
      void queryClient.invalidateQueries({ queryKey: ['visits'] });
      void queryClient.invalidateQueries({ queryKey: ['clinical-orders'] });
      opts?.onSuccess?.(data);
    },
    onError,
  });
}

export function useUpdateVisit(visitId: string) {
  const tCommon = useTranslations('common');
  return useVisitMutation(
    visitId,
    (body: UpdateVisitInput) => doctorApi.updateVisit(visitId, body),
    { successMessage: tCommon('saved') },
  );
}

export function useAmendVisit(visitId: string, onDone?: () => void) {
  const t = useTranslations('visits');
  return useVisitMutation(visitId, (body: AmendVisitInput) => doctorApi.amendVisit(visitId, body), {
    successMessage: t('amendmentSaved'),
    onSuccess: onDone,
  });
}

export function useUpsertVitals(visitId: string) {
  const t = useTranslations('visits');
  return useVisitMutation(
    visitId,
    (body: UpsertVitalsInput) => doctorApi.upsertVitals(visitId, body),
    { successMessage: t('vitalsSaved') },
  );
}

export function useAddDiagnosis(visitId: string) {
  const t = useTranslations('visits');
  return useVisitMutation(
    visitId,
    (body: AddDiagnosisInput) => doctorApi.addDiagnosis(visitId, body),
    { successMessage: t('diagnosisAdded') },
  );
}

export function useRemoveDiagnosis(visitId: string) {
  const tCommon = useTranslations('common');
  return useVisitMutation(visitId, (dxId: string) => doctorApi.removeDiagnosis(visitId, dxId), {
    successMessage: tCommon('deleted'),
  });
}

export function useReplacePrescriptions(visitId: string) {
  const t = useTranslations('visits');
  return useVisitMutation(
    visitId,
    (body: ReplacePrescriptionsInput) => doctorApi.replacePrescriptions(visitId, body),
    { successMessage: t('rx.saved') },
  );
}

export function useAddPrescription(visitId: string) {
  const t = useTranslations('visits');
  return useVisitMutation(
    visitId,
    (body: AddPrescriptionInput) => doctorApi.addPrescription(visitId, body),
    { successMessage: t('prescriptionAdded') },
  );
}

export function useRemovePrescription(visitId: string) {
  const tCommon = useTranslations('common');
  return useVisitMutation(visitId, (rxId: string) => doctorApi.removePrescription(visitId, rxId), {
    successMessage: tCommon('deleted'),
  });
}

export function useAddReferral(visitId: string) {
  const t = useTranslations('visits');
  return useVisitMutation(
    visitId,
    (body: AddReferralInput) => doctorApi.addReferral(visitId, body),
    { successMessage: t('referralAdded') },
  );
}

export function useCompleteVisit(visitId: string, onDone?: () => void) {
  const t = useTranslations('visits');
  return useVisitMutation(visitId, () => doctorApi.completeVisit(visitId), {
    successMessage: t('visitCompleted'),
    onSuccess: onDone,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const t = useTranslations('visits');
  return useMutation({
    mutationFn: (body: VisitTemplateUpsertInput) => doctorApi.createTemplate(body),
    onSuccess: () => {
      toast.success(t('templateSaved'));
      void queryClient.invalidateQueries({ queryKey: ['visit-templates'] });
    },
    onError,
  });
}
