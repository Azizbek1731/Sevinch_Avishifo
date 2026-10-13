'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { FileDown, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { formatTz } from '@/lib/dates';
import { Link } from '@/i18n/routing';
import { useApiErrorToast } from '../hooks';

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
  const onError = useApiErrorToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['visits', visitId, 'history'],
    queryFn: async () => (await api.get<ClinicalHistory>(`/visits/${visitId}/history`)).data,
  });
  const downloadLab = async (id: string) => {
    setDownloading(id);
    try {
      const res = await api.get<Blob>(`/lab-orders/${id}/pdf`);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'laboratory-result.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      onError(error);
    } finally {
      setDownloading(null);
    }
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" />
          {t('history')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {history.isLoading ? (
          <Skeleton className="h-32 w-full" />
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
                  {visit.reportBody ? (
                    <p className="whitespace-pre-wrap break-words">{visit.reportBody}</p>
                  ) : null}
                  {(['subjective', 'objective', 'assessmentNote', 'plan'] as const).map((field) =>
                    visit[field] ? (
                      <div key={field}>
                        <p className="font-medium">{tv(`soapFields.${field}`)}</p>
                        <p className="whitespace-pre-wrap break-words">{visit[field]}</p>
                      </div>
                    ) : null,
                  )}
                  {visit.prescriptions?.map((rx, index) => (
                    <p key={`${index}-${rx.drugName}`}>
                      {rx.drugName} {rx.dosage} {rx.frequency}
                      {rx.instructions ? ` · ${rx.instructions}` : ''}
                    </p>
                  ))}
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/doctor/visits/${visit.id}/print`}>{t('viewReport')}</Link>
                  </Button>
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloading === order.id}
                    onClick={() => void downloadLab(order.id)}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    PDF
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
