'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Lock, Printer } from 'lucide-react';
import { VisitStatus } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Link, useRouter } from '@/i18n/routing';
import { formatDate, formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { parseAllergies } from '../api';
import { useCompleteVisit, useVisit } from '../hooks';
import { DiagnosesSection } from './diagnoses-section';
import { PrescriptionsSection } from './prescriptions-section';
import { ReferralsSection } from './referrals-section';
import { SoapForm } from './soap-form';
import { VitalsForm } from './vitals-form';

export function VisitForm({ visitId }: { visitId: string }) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.permissions.includes('visits.write') ?? false;
  const canAmend = user?.permissions.includes('visits.amend') ?? false;

  const { data: visit, isLoading } = useVisit(visitId);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const completeVisit = useCompleteVisit(visitId, () => router.push('/doctor'));

  if (isLoading || !visit) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const locked = visit.status === VisitStatus.COMPLETED;
  const sectionsDisabled = locked || !canWrite;
  const allergies = parseAllergies(visit.patient.allergies);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('visitTitle', { patient: visit.patient.fullName })}
        description={visit.startedAt ? formatTz(visit.startedAt) : undefined}
      >
        <Button variant="outline" asChild>
          <Link href={`/doctor/visits/${visit.id}/print`}>
            <Printer className="mr-2 h-4 w-4" />
            {t('printSummary')}
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/doctor/visits/${visit.id}/print?mode=prescription`}>
            <Printer className="mr-2 h-4 w-4" />
            {t('printPrescription')}
          </Link>
        </Button>
        {!locked && canWrite ? (
          <Button onClick={() => setConfirmComplete(true)} disabled={completeVisit.isPending}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {t('completeVisit')}
          </Button>
        ) : null}
      </PageHeader>

      {/* Patient header */}
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
          {allergies.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {t('allergies')}: {allergies.map((a) => a.name).join(', ')}
              </p>
            </div>
          ) : null}
          {visit.patient.chronicConditions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{t('chronic')}:</span>
              {visit.patient.chronicConditions.map((c) => (
                <Badge key={c} variant="secondary">
                  {c}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Lock banner */}
      {locked ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <Lock className="h-4 w-4 shrink-0" />
          <p>
            {t('lockedBanner')}
            {canAmend ? ` ${t('lockedBannerAmend')}` : ''}
          </p>
        </div>
      ) : null}

      <VitalsForm
        key={`vitals-${visit.id}`}
        visitId={visit.id}
        vitals={visit.vitals}
        disabled={sectionsDisabled}
      />

      {(!locked && canWrite) || (locked && canAmend) ? (
        <SoapForm key={`soap-${visit.id}`} visit={visit} locked={locked} />
      ) : null}

      <DiagnosesSection
        visitId={visit.id}
        diagnoses={visit.diagnoses}
        disabled={sectionsDisabled}
      />
      <PrescriptionsSection
        visitId={visit.id}
        prescriptions={visit.prescriptions}
        disabled={sectionsDisabled}
      />
      <ReferralsSection
        visitId={visit.id}
        referrals={visit.referrals}
        disabled={sectionsDisabled}
      />

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title={t('completeConfirmTitle')}
        description={t('completeConfirmDesc')}
        confirmLabel={t('completeVisit')}
        cancelLabel={tCommon('cancel')}
        onConfirm={() => {
          setConfirmComplete(false);
          completeVisit.mutate(undefined);
        }}
      />
    </div>
  );
}
