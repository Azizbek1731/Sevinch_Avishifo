'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Lock,
  Paperclip,
  Plus,
  Printer,
  Upload,
} from 'lucide-react';
import { VisitStatus, formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { formatDate, formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { useAuthStore } from '@/stores/auth-store';
import { useClinicalOrder } from '@/features/clinical-orders/hooks';
import { ExtraClinicalServicesDialog } from '@/features/clinical-orders/components/order-dialog';
import { doctorApi, parseAllergies, type VisitDetail } from '../api';
import { useApiErrorToast, useCompleteVisit, useVisit } from '../hooks';
import { DiagnosesSection } from './diagnoses-section';
import { PrescriptionsSection } from './prescriptions-section';
import { ReferralsSection } from './referrals-section';
import { SoapForm } from './soap-form';
import { VitalsForm } from './vitals-form';
import { ClinicalHistoryPanel } from './clinical-history';
import { UziAttachments } from '@/features/uzi/components/uzi-attachments';
import { UltrasoundReport } from './ultrasound-report';

function visitHasClinicalContent(visit: VisitDetail): boolean {
  return Boolean(
    visit.diagnosisPrimary?.trim() ||
      visit.diagnosisSecondary?.trim() ||
      visit.subjective?.trim() ||
      visit.objective?.trim() ||
      visit.assessmentNote?.trim() ||
      visit.plan?.trim() ||
      visit.reportTitle?.trim() ||
      visit.reportBody?.trim() ||
      visit.physiotherapy?.trim() ||
      visit.diagnoses.length ||
      visit.prescriptions.length ||
      (visit.documents?.length ?? 0) > 0,
  );
}

export function VisitForm({ visitId }: { visitId: string }) {
  const t = useTranslations('visits');
  const tc = useTranslations('common');
  const locale = useLocale();
  const tr = useTranslations('doctor.clinical');
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const query = useVisit(visitId, { refetchInterval: 10_000 });
  const visit = query.data;
  const ownsVisit = user?.role !== 'DOCTOR' || visit?.doctorUserId === user.id;
  const canWrite = ownsVisit && (user?.permissions.includes('visits.write') ?? false);
  const canAmend = ownsVisit && (user?.permissions.includes('visits.amend') ?? false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [emptyReason, setEmptyReason] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const [soapDirty, setSoapDirty] = useState(false);
  const [vitalsDirty, setVitalsDirty] = useState(false);
  const [rxDirty, setRxDirty] = useState(false);
  const [dxDirty, setDxDirty] = useState(false);
  const [referralDirty, setReferralDirty] = useState(false);
  const [reportDirty, setReportDirty] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const examFileRef = useRef<HTMLInputElement>(null);
  const confirmFileRef = useRef<HTMLInputElement>(null);
  const pendingMutations = useIsMutating({ mutationKey: ['visits', visitId] });
  const completeVisit = useCompleteVisit(visitId, () => {
    setConfirmComplete(false);
    setEmptyReason('');
  });
  const order = useClinicalOrder(visit?.clinicalOrderId);
  const onError = useApiErrorToast();
  // Diagnosis autosaves on blur — don't block "Tasdiqlash" while the doctor is still typing it.
  const blockingUnsaved = soapDirty || vitalsDirty || rxDirty || referralDirty || reportDirty;
  const unsaved = blockingUnsaved || dxDirty;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      return doctorApi.uploadAttachment(visitId, form);
    },
    onSuccess: () => {
      toast.success(t('attachmentUploaded'));
      void queryClient.invalidateQueries({ queryKey: ['visits', visitId] });
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
    onError,
  });

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
  const docs = visit.documents ?? [];
  const hasContent = visitHasClinicalContent({ ...visit, documents: docs });
  const canComplete =
    canWrite &&
    !locked &&
    !cancelled &&
    !blockingUnsaved &&
    pendingMutations === 0 &&
    due === 0n &&
    !orderUnavailable;
  const canConfirmEmpty = hasContent || emptyReason.trim().length >= 3;

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
        <>
          <UltrasoundReport
            key={visit.id}
            visit={visit}
            disabled={sectionsDisabled}
            onUnsavedChange={setReportDirty}
          />
          {visit.clinicalOrderId ? (
            <UziAttachments
              orderId={visit.clinicalOrderId}
              attachments={order.data?.attachments ?? []}
              canUpload={!sectionsDisabled}
            />
          ) : null}
        </>
      ) : (
        <Tabs defaultValue="exam" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="exam">{t('tabs.exam')}</TabsTrigger>
            <TabsTrigger value="rx">{t('tabs.rx')}</TabsTrigger>
            <TabsTrigger value="referrals">{t('tabs.referrals')}</TabsTrigger>
          </TabsList>
          <TabsContent value="exam" className="mt-0 space-y-4">
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
              visit={visit}
              disabled={sectionsDisabled && !(locked && canAmend)}
              onUnsavedChange={setDxDirty}
            />
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Paperclip className="h-4 w-4" />
                  {t('attachmentsTitle')}
                </CardTitle>
                {!sectionsDisabled ? (
                  <>
                    <input
                      ref={examFileRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadAttachment.mutate(file);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadAttachment.isPending}
                      onClick={() => examFileRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadAttachment.isPending ? t('uploading') : t('uploadAttachment')}
                    </Button>
                  </>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{t('attachmentsHint')}</p>
                {docs.length ? (
                  <ul className="divide-y rounded-lg border">
                    {docs.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="truncate">{doc.title || doc.fileName}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('attachmentsEmpty')}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="rx" className="mt-0">
            <PrescriptionsSection
              visitId={visit.id}
              prescriptions={visit.prescriptions}
              prescriptionRevision={visit.prescriptionRevision}
              physiotherapy={visit.physiotherapy}
              disabled={sectionsDisabled}
              onUnsavedChange={setRxDirty}
            />
          </TabsContent>
          <TabsContent value="referrals" className="mt-0">
            <ReferralsSection
              visitId={visit.id}
              referrals={visit.referrals}
              disabled={sectionsDisabled}
              onUnsavedChange={setReferralDirty}
            />
          </TabsContent>
        </Tabs>
      )}
      {visit.clinicalOrderId ? (
        <ExtraClinicalServicesDialog
          open={!cancelled && extraOpen}
          onOpenChange={setExtraOpen}
          orderId={visit.clinicalOrderId}
          existingServiceIds={order.data?.services.map((service) => service.id)}
          doctor={
            order.data?.doctor
              ? {
                  id: order.data.doctor.id,
                  fullName: order.data.doctor.fullName,
                  specialty: null,
                }
              : null
          }
        />
      ) : null}

      <Dialog
        open={confirmComplete}
        onOpenChange={(open) => {
          if (completeVisit.isPending) return;
          setConfirmComplete(open);
          if (!open) setEmptyReason('');
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr('confirmTitle')}</DialogTitle>
            <DialogDescription>
              {hasContent ? tr('confirmDescription') : t('emptyConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          {!hasContent ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="empty-reason">{t('emptyConfirmReason')}</Label>
                <Textarea
                  id="empty-reason"
                  rows={3}
                  value={emptyReason}
                  onChange={(e) => setEmptyReason(e.target.value)}
                  placeholder={t('emptyConfirmReasonPlaceholder')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={confirmFileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadAttachment.mutate(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadAttachment.isPending}
                  onClick={() => confirmFileRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {t('uploadAttachment')}
                </Button>
                <span className="text-xs text-muted-foreground">{t('emptyConfirmOrUpload')}</span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={completeVisit.isPending}
              onClick={() => setConfirmComplete(false)}
            >
              {tc('cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                !canComplete ||
                completeVisit.isPending ||
                uploadAttachment.isPending ||
                !canConfirmEmpty
              }
              onClick={() => {
                if (!canComplete || !canConfirmEmpty) return;
                completeVisit.mutate(
                  hasContent ? {} : { emptyReason: emptyReason.trim() },
                );
              }}
            >
              {tr('confirmReport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
