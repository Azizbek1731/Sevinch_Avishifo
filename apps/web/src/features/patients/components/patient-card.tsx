'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { GitMerge, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import { formatPhone, formatUZS } from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api-client';
import { AddServicesDialog } from '@/features/billing/components/add-services-dialog';
import { patientsApi } from '../api';
import { useApiErrorToast, usePatient, usePermissions } from '../hooks';
import { MergePatientDialog } from './merge-patient-dialog';
import { PatientFormDialog } from './patient-form-dialog';
import { PatientDocumentsTab } from './patient-documents-tab';
import { PatientInvoicesTab } from './patient-invoices-tab';
import { PatientOverviewTab } from './patient-overview-tab';
import { ChargesPanel } from '@/features/admissions/components/charges-panel';
import { PatientTimelineTab } from './patient-timeline-tab';
import { PatientVisitsTab } from './patient-visits-tab';

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function PatientCardView({ patientId }: { patientId: string }) {
  const t = useTranslations('patients');
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const toastError = useApiErrorToast();

  const query = usePatient(patientId);
  const patient = query.data?.data;

  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addServicesOpen, setAddServicesOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => patientsApi.remove(patientId),
    onSuccess: () => {
      toast.success(t('deleted'));
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      router.push('/patients');
    },
    onError: toastError,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!patient) {
    const notFound =
      query.error instanceof ApiError && query.error.code === 'PATIENT_NOT_FOUND';
    return (
      <EmptyState
        icon={UserX}
        title={notFound ? t('card.notFound') : t('card.loadError')}
        action={
          <Button variant="outline" onClick={() => router.push('/patients')}>
            {t('card.backToList')}
          </Button>
        }
      />
    );
  }

  const negative = patient.balance.startsWith('-');
  const hasDebt = Number.parseFloat(patient.debt) > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg font-semibold">
              {initials(patient.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{patient.fullName}</h1>
              {patient.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {t(`tags.${tag}` as never)}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{patient.mrn}</span>
              {patient.age !== null ? <span>{t('card.ageYears', { age: patient.age })}</span> : null}
              {patient.phone ? <span>{formatPhone(patient.phone)}</span> : null}
              <span className={cn('font-medium', negative ? 'text-destructive' : 'text-success')}>
                {formatUZS(patient.balance)}
                {negative ? ` · ${t('card.debt')}` : ''}
              </span>
              {hasDebt ? (
                <span className="font-medium text-destructive">
                  {t('card.debt')}: {formatUZS(patient.debt)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can('invoices.write') ? (
            <Button size="sm" onClick={() => setAddServicesOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('card.addServices')}
            </Button>
          ) : null}
          {can('patients.write') ? (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              {t('card.edit')}
            </Button>
          ) : null}
          {can('patients.merge') ? (
            <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
              <GitMerge className="mr-1 h-4 w-4" />
              {t('card.merge')}
            </Button>
          ) : null}
          {can('patients.delete') ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t('card.delete')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('tabs.timeline')}</TabsTrigger>
          {can('charges.read') ? (
            <TabsTrigger value="charges">{t('tabs.charges')}</TabsTrigger>
          ) : null}
          {can('visits.read') ? (
            <TabsTrigger value="visits">
              {t('tabs.visits')} ({patient.counts.visits})
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="documents">
            {t('tabs.documents')} ({patient.counts.documents})
          </TabsTrigger>
          {can('invoices.read') || can('invoices.write') || can('payments.create') ? (
            <TabsTrigger value="invoices">
              {t('tabs.invoices')} ({patient.counts.invoices})
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <PatientOverviewTab patient={patient} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <PatientTimelineTab patientId={patient.id} />
        </TabsContent>
        {can('charges.read') ? (
          <TabsContent value="charges" className="mt-4">
            <ChargesPanel patientId={patient.id} />
          </TabsContent>
        ) : null}
        {can('visits.read') ? (
          <TabsContent value="visits" className="mt-4">
            <PatientVisitsTab patientId={patient.id} />
          </TabsContent>
        ) : null}
        <TabsContent value="documents" className="mt-4">
          <PatientDocumentsTab patientId={patient.id} />
        </TabsContent>
        {can('invoices.read') || can('invoices.write') || can('payments.create') ? (
          <TabsContent value="invoices" className="mt-4">
            <PatientInvoicesTab
              patientId={patient.id}
              patient={{
                id: patient.id,
                mrn: patient.mrn,
                fullName: patient.fullName,
                phone: patient.phone,
              }}
            />
          </TabsContent>
        ) : null}
      </Tabs>

      <AddServicesDialog
        open={addServicesOpen}
        onOpenChange={setAddServicesOpen}
        patient={{
          id: patient.id,
          mrn: patient.mrn,
          fullName: patient.fullName,
          phone: patient.phone,
        }}
      />
      <PatientFormDialog open={editOpen} onOpenChange={setEditOpen} patient={patient} />
      <MergePatientDialog open={mergeOpen} onOpenChange={setMergeOpen} primary={patient} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('card.deleteTitle')}
        description={t('card.deleteDesc', { name: patient.fullName })}
        confirmLabel={t('card.delete')}
        cancelLabel={t('form.cancel')}
        destructive
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
