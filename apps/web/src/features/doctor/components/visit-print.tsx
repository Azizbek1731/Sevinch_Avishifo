'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/routing';
import { API_URL } from '@/lib/api-client';
import { formatDate, formatTz } from '@/lib/dates';
import type { VisitPrintPayload } from '../api';
import { useVisitPrint } from '../hooks';

function icd10Name(
  item: { nameUz: string; nameRu: string | null; nameEn: string | null },
  locale: string,
): string {
  if (locale === 'ru' && item.nameRu) return item.nameRu;
  if (locale === 'en' && item.nameEn) return item.nameEn;
  return item.nameUz;
}

function Letterhead({ payload }: { payload: VisitPrintPayload }) {
  const logoSrc = payload.clinic.logoUrl
    ? payload.clinic.logoUrl.startsWith('http')
      ? payload.clinic.logoUrl
      : `${API_URL}${payload.clinic.logoUrl}`
    : null;
  return (
    <header className="mb-6 flex items-center justify-between border-b-2 border-black pb-4">
      <div className="flex items-center gap-3">
        {logoSrc ? (
          /* Plain img: clinic logo comes from the API host and must render for print. */
          <img src={logoSrc} alt="" className="h-14 w-14 object-contain" />
        ) : null}
        <div>
          <p className="text-xl font-bold">{payload.clinic.name}</p>
          {payload.clinic.address ? <p className="text-sm">{payload.clinic.address}</p> : null}
          {payload.clinic.phone ? <p className="text-sm">{payload.clinic.phone}</p> : null}
        </div>
      </div>
    </header>
  );
}

export function VisitPrint({ visitId }: { visitId: string }) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'prescription' ? 'prescription' : 'summary';
  const auto = searchParams.get('auto') === '1';

  const { data: payload, isLoading } = useVisitPrint(visitId);
  const printedRef = useRef(false);

  useEffect(() => {
    if (auto && payload && !printedRef.current) {
      printedRef.current = true;
      // Let the letterhead/logo paint before opening the dialog.
      const timer = setTimeout(() => window.print(), 300);
      return () => clearTimeout(timer);
    }
  }, [auto, payload]);

  if (isLoading || !payload) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { visit } = payload;

  const soapBlocks: Array<{ label: string; value: string | null }> = [
    { label: t('soapFields.subjective'), value: visit.subjective },
    { label: t('soapFields.objective'), value: visit.objective },
    { label: t('soapFields.assessmentNote'), value: visit.assessmentNote },
    { label: t('soapFields.plan'), value: visit.plan },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link href={`/doctor/visits/${visitId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {tCommon('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          {tCommon('print')}
        </Button>
      </div>

      <div className="print-area rounded-md border bg-white p-8 text-black shadow-sm">
        <Letterhead payload={payload} />

        <h1 className="mb-4 text-center text-lg font-bold uppercase">
          {mode === 'prescription' ? t('printPrescriptionTitle') : t('printSummaryTitle')}
        </h1>

        <section className="mb-5 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <p>
            <span className="font-semibold">{tCommon('patient')}:</span>{' '}
            {payload.patient.fullName}
          </p>
          <p>
            <span className="font-semibold">{t('mrn')}:</span> {payload.patient.mrn}
          </p>
          {payload.patient.dob ? (
            <p>
              <span className="font-semibold">{t('dob')}:</span>{' '}
              {formatDate(payload.patient.dob)}
            </p>
          ) : null}
          <p>
            <span className="font-semibold">{tCommon('date')}:</span>{' '}
            {visit.startedAt ? formatTz(visit.startedAt) : '—'}
          </p>
        </section>

        {mode === 'summary' ? (
          <>
            {soapBlocks.map((block) =>
              block.value ? (
                <section key={block.label} className="mb-4">
                  <h2 className="mb-1 text-sm font-bold">{block.label}</h2>
                  <p className="whitespace-pre-wrap text-sm">{block.value}</p>
                </section>
              ) : null,
            )}

            {visit.diagnoses.length > 0 ? (
              <section className="mb-4">
                <h2 className="mb-1 text-sm font-bold">{t('diagnoses')}</h2>
                <ul className="space-y-0.5 text-sm">
                  {visit.diagnoses.map((dx) => (
                    <li key={dx.id}>
                      <span className="font-mono font-semibold">{dx.icd10.code}</span> —{' '}
                      {icd10Name(dx.icd10, locale)}
                      {dx.isPrimary ? ` (${t('primary')})` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {visit.prescriptions.length > 0 ? (
          <section className="mb-4">
            <h2 className="mb-1 text-sm font-bold">{t('prescriptions')}</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {visit.prescriptions.map((rx) => (
                <li key={rx.id}>
                  <span className="font-semibold">{rx.drugName}</span>
                  {rx.dosage ? ` — ${rx.dosage}` : ''}
                  {rx.frequency ? `, ${rx.frequency}` : ''}
                  {rx.durationDays ? `, ${t('days', { count: rx.durationDays })}` : ''}
                  {rx.instructions ? (
                    <span className="block text-xs">{rx.instructions}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : mode === 'prescription' ? (
          <p className="mb-4 text-sm text-muted-foreground">{t('noPrescriptions')}</p>
        ) : null}

        {mode === 'summary' && visit.nextVisitAt ? (
          <p className="mb-4 text-sm">
            <span className="font-semibold">{t('nextVisit')}:</span>{' '}
            {formatDate(visit.nextVisitAt)}
          </p>
        ) : null}

        <footer className="mt-10 flex items-end justify-between text-sm">
          <div>
            <p className="font-semibold">{payload.doctor.fullName}</p>
            {payload.doctor.specialty ? <p>{payload.doctor.specialty}</p> : null}
          </div>
          <div className="w-56">
            <div className="border-b border-black" />
            <p className="mt-1 text-center text-xs">{t('signature')}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
