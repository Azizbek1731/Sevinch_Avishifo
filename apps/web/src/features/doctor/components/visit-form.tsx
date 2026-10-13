'use client';

import { useEffect, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, FileDown, Lock, Plus, Printer } from 'lucide-react';
import { VisitStatus, formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { formatDate, formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { useAuthStore } from '@/stores/auth-store';
import { useClinicalOrder } from '@/features/clinical-orders/hooks';
import { ExtraClinicalServicesDialog } from '@/features/clinical-orders/components/order-dialog';
import { parseAllergies } from '../api';
import { useApiErrorToast, useCompleteVisit, useVisit } from '../hooks';
import { DiagnosesSection } from './diagnoses-section';
import { PrescriptionsSection } from './prescriptions-section';
import { ReferralsSection } from './referrals-section';
import { SoapForm } from './soap-form';
import { VitalsForm } from './vitals-form';
import { ClinicalHistoryPanel } from './clinical-history';
import { UltrasoundReport } from './ultrasound-report';

export function VisitForm({ visitId }: { visitId: string }) {
  const t = useTranslations('visits');
  const tc = useTranslations('common');
  const locale = useLocale();
  const tr = useTranslations('doctor.clinical');
  const user = useAuthStore((s) => s.user);
  const query = useVisit(visitId);
  const visit = query.data;
  const ownsVisit = user?.role !== 'DOCTOR' || visit?.doctorUserId === user.id;
  const canWrite = ownsVisit && (user?.permissions.includes('visits.write') ?? false);
  const canAmend = ownsVisit && (user?.permissions.includes('visits.amend') ?? false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [soapDirty, setSoapDirty] = useState(false);
  const [vitalsDirty, setVitalsDirty] = useState(false);
  const [rxDirty, setRxDirty] = useState(false);
  const [dxDirty, setDxDirty] = useState(false);
  const [referralDirty, setReferralDirty] = useState(false);
  const [reportDirty, setReportDirty] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const pendingMutations = useIsMutating({ mutationKey: ['visits', visitId] });
  const completeVisit = useCompleteVisit(visitId);
  const order = useClinicalOrder(visit?.clinicalOrderId);
  const onError = useApiErrorToast();
  const unsaved = soapDirty || vitalsDirty || rxDirty || dxDirty || referralDirty || reportDirty;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const response = await api.get<Blob>(`/visits/${visitId}/pdf`);
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clinical-report.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onError(error);
    } finally {
      setDownloading(false);
    }
  };
  if (query.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (query.isError || !visit)
    return (
      <div role="alert" className="rounded-xl border p-8">
        <p>{tr('loadError')}</p>
        <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
          {tr('refresh')}
        </Button>
      </div>
    );
  const locked = visit.status === VisitStatus.COMPLETED;
  const cancelled = visit.status === VisitStatus.CANCELLED || order.data?.status === 'CANCELLED';
  const sectionsDisabled = locked || cancelled || !canWrite || completeVisit.isPending;
  const ultrasound = visit.kind === 'ULTRASOUND';
  const allergies = parseAllergies(visit.patient.allergies);
  const chronicConditions = Array.isArray(visit.patient.chronicConditions)
    ? visit.patient.chronicConditions.filter((value): value is string => typeof value === 'string')
    : [];
  const due = order.data ? toTiyin(order.data.invoice.due) + toTiyin(order.data.additionalDue) : 0n;
  const orderUnavailable = Boolean(visit.clinicalOrderId) && (!order.data || order.isError);
  const reportReady = !ultrasound || Boolean(visit.reportTitle?.trim() && visit.reportBody?.trim());
  const canComplete =
    canWrite &&
    !locked &&
    !cancelled &&
    reportReady &&
    !unsaved &&
    pendingMutations === 0 &&
    due === 0n &&
    !orderUnavailable;
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          ultrasound ? tr('ultrasoundReport') : t('visitTitle', { patient: visit.patient.fullName })
        }
        description={visit.startedAt ? formatTz(visit.startedAt) : undefined}
      >
        <Button variant="ghost" asChild>
          <Link href="/doctor">{tc('back')}</Link>
        </Button>
        {locked ? (
          <>
            <Button variant="outline" asChild>
              <Link href={`/doctor/visits/${visit.id}/print`}>
                <Printer className="mr-2 h-4 w-4" />
                {t('printSummary')}
              </Link>
            </Button>
            {!ultrasound ? (
              <Button variant="outline" asChild>
                <Link href={`/doctor/visits/${visit.id}/print?mode=prescription`}>
                  <Printer className="mr-2 h-4 w-4" />
                  {t('printPrescription')}
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" disabled={downloading} onClick={() => void downloadPdf()}>
              <FileDown className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </>
        ) : null}
        {!locked && !cancelled && canWrite ? (
          <Button onClick={() => setConfirmComplete(true)} disabled={!canComplete}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {tr('confirmReport')}
          </Button>
        ) : null}
      </PageHeader>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{visit.patient.fullName}</p>
              <p className="text-sm text-muted-foreground">
                {visit.patient.mrn}
                {visit.patient.dob ? ` · ${formatDate(visit.patient.dob)}` : ''}
                {visit.patient.phone ? ` · ${visit.patient.phone}` : ''}
              </p>
            </div>
            <StatusBadge status={visit.status} group="visit" />
          </div>
          {allergies.length ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {t('allergies')}: {allergies.map((a) => a.name).join(', ')}
              </p>
            </div>
          ) : null}
          {chronicConditions.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{t('chronic')}:</span>
              {chronicConditions.map((item) => (
                <Badge key={item} variant="secondary">
                  {item}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {locked ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <Lock className="h-4 w-4 shrink-0" />
          <p>
            {tr('confirmedHint')}
            {!ultrasound && canAmend ? ` ${t('lockedBannerAmend')}` : ''}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          {tr(cancelled ? 'cancelledHint' : unsaved ? 'saveBeforeConfirm' : 'confirmHint')}
        </div>
      )}
      {order.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {tr('paymentLoadError')}
        </p>
      ) : null}
      {order.data ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">
                {order.data.services
                  .map((service) => localizedText(service.title, locale))
                  .join(' · ')}
              </p>
              <p
                className={
                  due > 0n
                    ? 'mt-1 text-sm font-medium text-amber-700'
                    : 'mt-1 text-sm text-emerald-700'
                }
              >
                {due > 0n ? tr('unpaid', { amount: formatUZS(fromTiyin(due)) }) : tr('allPaid')}
              </p>
              {due > 0n ? (
                <p className="mt-1 text-xs text-muted-foreground">{tr('extraAwaitPayment')}</p>
              ) : null}
            </div>
            {ultrasound && !sectionsDisabled ? (
              <Button variant="outline" onClick={() => setExtraOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {tr('extraServices')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <ClinicalHistoryPanel visitId={visit.id} />
      {ultrasound ? (
        <UltrasoundReport
          key={visit.id}
          visit={visit}
          disabled={sectionsDisabled}
          onUnsavedChange={setReportDirty}
        />
      ) : (
        <>
          <VitalsForm
            key={`vitals-${visit.id}`}
            visitId={visit.id}
            vitals={visit.vitals}
            disabled={sectionsDisabled}
            onUnsavedChange={setVitalsDirty}
          />
          {!cancelled && ((!locked && canWrite) || (locked && canAmend)) ? (
            <SoapForm
              key={`soap-${visit.id}`}
              visit={visit}
              locked={locked}
              onUnsavedChange={setSoapDirty}
            />
          ) : (
            <Card>
              <CardContent className="space-y-4 p-4">
                {(['subjective', 'objective', 'assessmentNote', 'plan'] as const).map((field) =>
                  visit[field] ? (
                    <section key={field}>
                      <h3 className="font-semibold">{t(`soapFields.${field}`)}</h3>
                      <p className="whitespace-pre-wrap text-sm">{visit[field]}</p>
                    </section>
                  ) : null,
                )}
              </CardContent>
            </Card>
          )}
          <DiagnosesSection
            visitId={visit.id}
            diagnoses={visit.diagnoses}
            disabled={sectionsDisabled}
            onUnsavedChange={setDxDirty}
          />
          <PrescriptionsSection
            visitId={visit.id}
            prescriptions={visit.prescriptions}
            prescriptionRevision={visit.prescriptionRevision}
            physiotherapy={visit.physiotherapy}
            disabled={sectionsDisabled}
            onUnsavedChange={setRxDirty}
          />
          <ReferralsSection
            visitId={visit.id}
            referrals={visit.referrals}
            disabled={sectionsDisabled}
            onUnsavedChange={setReferralDirty}
          />
        </>
      )}
      {visit.clinicalOrderId ? (
        <ExtraClinicalServicesDialog
          open={!cancelled && extraOpen}
          onOpenChange={setExtraOpen}
          orderId={visit.clinicalOrderId}
          existingServiceIds={order.data?.services.map((service) => service.id)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title={tr('confirmTitle')}
        description={tr('confirmDescription')}
        confirmLabel={tr('confirmReport')}
        cancelLabel={tc('cancel')}
        onConfirm={() => {
          setConfirmComplete(false);
          if (canComplete) completeVisit.mutate(undefined);
        }}
      />
    </div>
  );
}
