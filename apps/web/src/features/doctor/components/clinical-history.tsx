'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { ClinicalHtmlView } from '@/components/clinical-html-view';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { formatTz } from '@/lib/dates';
import { stripClinicalHtml } from '@/lib/clinical-html';
import { Link } from '@/i18n/routing';
import { LabPdfButton } from '@/features/lab/components/lab-pdf-button';
import { usePdfPrinted } from '@/lib/pdf-printed';

interface ClinicalHistory {
  visits: Array<{
    id: string;
    kind: 'CONSULTATION' | 'ULTRASOUND';
    reportTitle: string | null;
    startedAt: string | null;
    doctor: { fullName: string };
    diagnoses: Array<{ code: string; name: string }>;
    subjective?: string | null;
    objective?: string | null;
    assessmentNote?: string | null;
    plan?: string | null;
    reportBody?: string | null;
    prescriptions?: Array<{
      drugName: string;
      dosage?: string | null;
      frequency?: string | null;
      instructions?: string | null;
    }>;
  }>;
  labOrders: Array<{ id: string; orderNumber: string; status: string; createdAt: string }>;
}

export function ClinicalHistoryPanel({ visitId }: { visitId: string }) {
  const t = useTranslations('doctor.clinical');
  const tv = useTranslations('visits');
  const history = useQuery({
    queryKey: ['visits', visitId, 'history'],
    refetchInterval: 10_000,
    queryFn: async () => (await api.get<ClinicalHistory>(`/visits/${visitId}/history`)).data,
  });
  const count =
    (history.data?.visits.length ?? 0) + (history.data?.labOrders.length ?? 0);

  return (
    <details className="rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
        <History className="h-4 w-4" />
        {t('history')}
        {count > 0 ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {count}
          </span>
        ) : null}
      </summary>
      <div className="space-y-3 border-t px-4 py-3">
        {history.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : history.isError ? (
          <div role="alert" className="text-sm text-destructive">
            {t('loadError')}{' '}
            <Button variant="link" onClick={() => void history.refetch()}>
              {t('refresh')}
            </Button>
          </div>
        ) : (
          <>
            {!history.data?.visits.length && !history.data?.labOrders.length ? (
              <p className="text-sm text-muted-foreground">{t('noHistory')}</p>
            ) : null}
            {history.data?.visits.map((visit) => (
              <details key={visit.id} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">
                    {visit.reportTitle ||
                      t(visit.kind === 'ULTRASOUND' ? 'ultrasound' : 'consultation')}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {visit.startedAt ? formatTz(visit.startedAt) : ''} · {visit.doctor.fullName}
                  </span>
                </summary>
                <div className="mt-3 space-y-3 text-sm">
                  {visit.diagnoses.length ? (
                    <p>
                      {visit.diagnoses
                        .map((diagnosis) => `${diagnosis.code} — ${diagnosis.name}`)
                        .join('; ')}
                    </p>
                  ) : null}
                  {visit.reportBody && stripClinicalHtml(visit.reportBody) ? (
                    <ClinicalHtmlView value={visit.reportBody} />
                  ) : null}
                  {(['subjective', 'objective', 'assessmentNote', 'plan'] as const).map((field) =>
                    visit[field] && stripClinicalHtml(visit[field]!) ? (
                      <div key={field}>
                        <p className="font-medium">{tv(`soapFields.${field}`)}</p>
                        <ClinicalHtmlView value={visit[field]!} />
                      </div>
                    ) : null,
                  )}
                  {visit.prescriptions?.map((rx, index) => (
                    <p key={`${index}-${rx.drugName}`}>
                      {rx.drugName} {rx.dosage} {rx.frequency}
                      {rx.instructions ? ` · ${rx.instructions}` : ''}
                    </p>
                  ))}
                  <HistoryVisitPrintLink visitId={visit.id} label={t('viewReport')} />
                </div>
              </details>
            ))}
            {history.data?.labOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {t('labResult')} · {order.orderNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatTz(order.createdAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/lab/${order.id}`} target="_blank" rel="noopener noreferrer">
                      {t('viewReport')}
                    </Link>
                  </Button>
                  <LabPdfButton orderId={order.id} orderNumber={order.orderNumber} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </details>
  );
}

function HistoryVisitPrintLink({ visitId, label }: { visitId: string; label: string }) {
  const tv = useTranslations('visits');
  const printed = usePdfPrinted('visit', visitId);
  return (
    <Button
      variant={printed.printed ? 'default' : 'outline'}
      size="sm"
      className={printed.className}
      title={printed.printed ? tv('pdfPrinted') : undefined}
      asChild
    >
      <Link href={`/doctor/visits/${visitId}/print`}>{label}</Link>
    </Button>
  );
}
