'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatPrescriptionGroup, groupPrescriptionItems } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClinicDocumentFooter,
  ClinicLetterhead,
  useClinicPrintAssets,
} from '@/components/print/clinic-letterhead';
import { Link } from '@/i18n/routing';
import { formatDate, formatTz } from '@/lib/dates';
import { useVisitPrint } from '../hooks';

function icd10Name(
  item: { nameUz: string; nameRu: string | null; nameEn: string | null },
  locale: string,
): string {
  if (locale === 'ru' && item.nameRu) return item.nameRu;
  if (locale === 'en' && item.nameEn) return item.nameEn;
  return item.nameUz;
}

export function VisitPrint({ visitId }: { visitId: string }) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const tr = useTranslations('doctor.clinical');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode') === 'prescription' ? 'prescription' : 'summary';
  const auto = searchParams.get('auto') === '1';

  const { data: payload, isLoading, isError, refetch } = useVisitPrint(visitId);
  const printedRef = useRef(false);
  const printAssets = useClinicPrintAssets(payload?.clinic.logoUrl);

  useEffect(() => {
    if (auto && payload?.visit.status === 'COMPLETED' && printAssets.ready && !printedRef.current) {
      const timer = setTimeout(() => {
        printedRef.current = true;
        window.print();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [auto, payload, printAssets.ready]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !payload)
    return (
      <div role="alert" className="space-y-3 rounded-xl border p-8">
        <p>{tr('loadError')}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {tr('refresh')}
        </Button>
      </div>
    );
  const { visit } = payload;
  if (visit.status !== 'COMPLETED')
    return (
      <div className="space-y-3 rounded-xl border p-8">
        <p>{tr('confirmBeforePrint')}</p>
        <Button variant="outline" asChild>
          <Link href={`/doctor/visits/${visitId}`}>{tCommon('back')}</Link>
        </Button>
      </div>
    );
  const ultrasound = visit.kind === 'ULTRASOUND';

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
        <Button onClick={() => window.print()} disabled={!printAssets.ready}>
          <Printer className="mr-2 h-4 w-4" />
          {tCommon('print')}
        </Button>
      </div>

      <div className="print-area print-flow clinic-document-print clinical-report-print rounded-md border bg-white p-8 text-black shadow-sm">
        <ClinicLetterhead clinic={payload.clinic} onLogoReady={printAssets.onReady} />

        <h1 className="mb-4 border-b border-[#dce3ed] pb-3 text-center text-lg font-bold uppercase text-[#173f91]">
          {ultrasound
            ? visit.reportTitle || tr('ultrasoundReport')
            : mode === 'prescription'
              ? t('printPrescriptionTitle')
              : t('printSummaryTitle')}
        </h1>

        <section className="mb-5 grid grid-cols-2 gap-x-8 gap-y-1 rounded border border-[#dce3ed] px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold">{tCommon('patient')}:</span> {payload.patient.fullName}
          </p>
          <p>
            <span className="font-semibold">{t('mrn')}:</span> {payload.patient.mrn}
          </p>
          {payload.patient.dob ? (
            <p>
              <span className="font-semibold">{t('dob')}:</span> {formatDate(payload.patient.dob)}
            </p>
          ) : null}
          <p>
            <span className="font-semibold">{tCommon('date')}:</span>{' '}
            {visit.startedAt ? formatTz(visit.startedAt) : '—'}
          </p>
        </section>

        {ultrasound ? (
          <div className="mb-6 whitespace-pre-wrap break-words font-serif text-base leading-7">
            {visit.reportBody}
          </div>
        ) : null}

        {mode === 'summary' && !ultrasound ? (
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

        {!ultrasound && visit.prescriptions.length > 0 ? (
          <section className="mb-4">
            <h2 className="mb-1 text-sm font-bold">{t('prescriptions')}</h2>
            <div className="space-y-4 text-sm">
              {groupPrescriptionItems(visit.prescriptions).map((group) => {
                const lines = formatPrescriptionGroup(group, {
                  days: (count) => t('days', { count }),
                  dripUnit: t('rx.dripUnit'),
                });
                return (
                  <div
                    key={group[0]!.id}
                    className="prescription-group whitespace-pre-wrap break-words"
                  >
                    {lines.components.map((component, index) => (
                      <p key={group[index]!.id} className={index === 0 ? 'font-semibold' : 'pl-7'}>
                        {index === 0 ? 'Rp.: ' : ''}
                        {component}
                      </p>
                    ))}
                    {lines.dtd ? <p className="pl-7">{lines.dtd}</p> : null}
                    {lines.signature ? <p className="pl-7">S.: {lines.signature}</p> : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : mode === 'prescription' && !ultrasound ? (
          <p className="mb-4 text-sm text-muted-foreground">{t('noPrescriptions')}</p>
        ) : null}

        {!ultrasound && visit.physiotherapy ? (
          <section className="mb-4">
            <h2 className="mb-1 text-sm font-bold">{t('rx.physiotherapy')}</h2>
            <p className="whitespace-pre-wrap break-words text-sm">{visit.physiotherapy}</p>
          </section>
        ) : null}

        {mode === 'summary' && visit.nextVisitAt ? (
          <p className="mb-4 text-sm">
            <span className="font-semibold">{t('nextVisit')}:</span> {formatDate(visit.nextVisitAt)}
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
        <ClinicDocumentFooter clinic={payload.clinic} />
      </div>
    </div>
  );
}
