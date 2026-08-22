'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { API_URL, api } from '@/lib/api-client';
import { formatDate, formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface PrintPayload {
  clinic: { name: string; logoUrl: string | null; address: string | null; phone: string | null };
  admission: Record<string, string | number | boolean | null>;
  patient: {
    fullName: string;
    mrn: string;
    dob: string | null;
    gender: string | null;
    address: string | null;
    phone: string | null;
    passportId: string | null;
    bloodGroup: string;
    allergies: unknown;
  };
  doctor: { fullName: string | null };
  orders: Array<{
    service: Record<string, string>;
    schedule: string;
    startDate: string;
    timesPlanned: number;
    timesPerDay: number;
    days: Array<{ date: string; slots: Array<{ slot: number; status: string | null }> }>;
  }>;
  dailyNotes: Array<{
    date: string;
    condition: string;
    temperatureC: number | null;
    pulseBpm: number | null;
    bpSystolic: number | null;
    bpDiastolic: number | null;
  }>;
}

/** A numbered item of the paper form: the label, a rule, and the value on it. */
function Item({ n, label, value }: { n?: string; label: string; value?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex gap-1.5 text-[13px] leading-snug">
      <span className="shrink-0">
        {n ? <span className="font-semibold">{n}. </span> : null}
        {label}
      </span>
      <span className="min-w-0 flex-1 border-b border-dotted border-black px-1">
        {value || ' '}
      </span>
    </div>
  );
}

/** A block that runs to several lines — the form prints ruled space for these. */
function Block({ title, value, lines = 3 }: { title: string; value?: string | null; lines?: number }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[13px] font-semibold">{title}</p>
      {value ? (
        <p className="whitespace-pre-wrap border-b border-dotted border-black pb-0.5 text-[13px] leading-relaxed">
          {value}
        </p>
      ) : (
        // Empty fields still print their ruled lines: a form handed to a doctor
        // half-filled is written on by hand, and there has to be room.
        Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-5 border-b border-dotted border-black" />
        ))
      )}
    </div>
  );
}

/**
 * Kasallik tarixi — form 003/h, laid out as the paper form is.
 *
 * The order and the numbering are the form's, not ours: a clinic files these
 * and an inspector reads them against the printed original, so an item that
 * moves or loses its number makes the document harder to accept. Empty fields
 * print their ruled lines rather than collapsing, because a partly-filled form
 * is completed by hand.
 */
export function AdmissionPrint({ admissionId }: { admissionId: string }) {
  const t = useTranslations('admissions');
  const tp = useTranslations('admissionPrint');

  const query = useQuery({
    queryKey: ['admission', admissionId, 'print'],
    queryFn: async () => (await api.get<PrintPayload>(`/admissions/${admissionId}/print`)).data,
  });

  if (query.isLoading) return <Skeleton className="h-[60vh] w-full" />;
  const p = query.data;
  if (!p) return null;

  const a = p.admission as Record<string, string | number | boolean | null>;
  const str = (k: string): string => (a[k] == null ? '' : String(a[k]));
  const logoSrc = p.clinic.logoUrl
    ? p.clinic.logoUrl.startsWith('http')
      ? p.clinic.logoUrl
      : `${API_URL}${p.clinic.logoUrl}`
    : null;

  const allergies = Array.isArray(p.patient.allergies)
    ? (p.patient.allergies as Array<{ name: string }>).map((x) => x.name).join(', ')
    : '';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link href={`/admissions/${admissionId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          {t('print')}
        </Button>
      </div>

      <div className="print-area print-flow rounded-md border bg-white p-8 text-black shadow-sm">
        {/* Blank shapkasi */}
        <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div className="flex items-start gap-3">
            {logoSrc ? (
              /* Plain img: the logo comes from the API host and must render for print. */
              <img src={logoSrc} alt="" className="h-12 w-12 object-contain" />
            ) : null}
            <div className="text-[12px] leading-tight">
              <p className="font-semibold">{tp('ministry')}</p>
              <p className="text-[13px] font-bold">{p.clinic.name}</p>
              {p.clinic.address ? <p>{p.clinic.address}</p> : null}
              {p.clinic.phone ? <p>{p.clinic.phone}</p> : null}
            </div>
          </div>
          <div className="shrink-0 border border-black px-2 py-1 text-center text-[11px] leading-tight">
            <p>{tp('docLabel')}</p>
            <p className="font-bold">{tp('formNo')}</p>
          </div>
        </header>

        <h1 className="mb-1 text-center text-[15px] font-bold uppercase">{tp('title')}</h1>
        <p className="mb-4 text-center text-[13px]">
          № <span className="font-bold">{str('historyNumber')}</span>
        </p>

        {/* Qabul va chiqish */}
        <div className="mb-4 grid grid-cols-2 gap-x-8">
          <Item label={tp('admittedAt')} value={a.admittedAt ? formatTz(String(a.admittedAt)) : ''} />
          <Item label={tp('dischargedAt')} value={a.dischargedAt ? formatTz(String(a.dischargedAt)) : ''} />
          <Item label={tp('department')} value={str('department')} />
          <Item label={tp('ward')} value={[str('ward'), str('bed') && `${tp('bed')} ${str('bed')}`].filter(Boolean).join(', ')} />
          <Item label={tp('bedDays')} value={String(a.bedDays ?? '')} />
          <Item label={tp('bloodGroup')} value={p.patient.bloodGroup === 'UNKNOWN' ? '' : p.patient.bloodGroup} />
        </div>

        <Item label={tp('allergy')} value={allergies} />

        {/* 1–5: bemor haqida */}
        <div className="mt-4">
          <Item n="1" label={tp('fullName')} value={p.patient.fullName} />
          <div className="grid grid-cols-2 gap-x-8">
            <Item n="2" label={tp('gender')} value={p.patient.gender ? tp(`genders.${p.patient.gender}`) : ''} />
            <Item n="3" label={tp('dob')} value={p.patient.dob ? formatDate(p.patient.dob) : ''} />
          </div>
          <Item n="4" label={tp('address')} value={[p.patient.address, p.patient.phone].filter(Boolean).join(', ')} />
          <Item n="5" label={tp('passport')} value={p.patient.passportId ?? ''} />
        </div>

        {/* 6, 7, 12 */}
        <div className="mt-4">
          <Item n="6" label={tp('referredBy')} value={str('referredBy')} />
          <Item n="12" label={tp('firstTimeThisYear')} value={a.firstTimeThisYear === null ? '' : tp(a.firstTimeThisYear ? 'yes' : 'no')} />
        </div>

        {/* 8–11: tashxislar */}
        <div className="mt-4">
          <Item n="8" label={tp('referralDiagnosis')} value={str('referralDiagnosis')} />
          <Item n="9" label={tp('admissionDiagnosis')} value={str('admissionDiagnosis')} />
          <Item n="10" label={tp('clinicalDiagnosis')} value={str('clinicalDiagnosis')} />
          <Item label={tp('clinicalDiagnosisAt')} value={a.clinicalDiagnosisAt ? formatDate(String(a.clinicalDiagnosisAt)) : ''} />
          <Item n="11а" label={tp('finalMain')} value={str('finalDiagnosisMain')} />
          <Item n="11б" label={tp('finalComplication')} value={str('finalDiagnosisComplication')} />
          <Item n="11в" label={tp('finalComorbid')} value={str('finalDiagnosisComorbid')} />
        </div>

        {/* 16: natija */}
        <div className="mt-4">
          <Item n="16" label={tp('outcome')} value={a.outcome ? t(`outcomes.${String(a.outcome)}`) : ''} />
        </div>

        {/* Ichki bo'limlar — har biri yangi sahifadan, qog'ozdagidek */}
        <div className="page-break mt-6">
          <h2 className="mb-3 text-center text-[14px] font-bold uppercase">{tp('anamnesisTitle')}</h2>
          <Block title={tp('complaints')} value={str('complaints')} lines={4} />
          <Block title={tp('anamnesisMorbi')} value={str('anamnesisMorbi')} lines={6} />
          <Block title={tp('anamnesisVitae')} value={str('anamnesisVitae')} lines={6} />
          <Block title={tp('objectiveStatus')} value={str('objectiveStatus')} lines={8} />
          <Block title={tp('preliminaryDiagnosis')} value={str('preliminaryDiagnosis')} lines={2} />
          <Block title={tp('treatmentPlan')} value={str('treatmentPlan')} lines={4} />
        </div>

        {/* Muolajalar varag'i */}
        {p.orders.length > 0 ? (
          <div className="page-break mt-6">
            <h2 className="mb-3 text-center text-[14px] font-bold uppercase">{tp('sheetTitle')}</h2>
            {(() => {
              // Columns are the union of every order's dates — orders that start on
              // different days must not shift each other's marks under wrong dates.
              const columnDates = [
                ...new Set(p.orders.flatMap((o) => o.days.map((d) => d.date))),
              ].sort();
              return (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className="border border-black px-1 py-1 text-left">{tp('service')}</th>
                      {columnDates.map((date) => (
                        <th key={date} className="border border-black px-1 py-1 font-normal">
                          {date.slice(8)}.{date.slice(5, 7)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.orders.map((o, i) => (
                      <tr key={i}>
                        <td className="border border-black px-1 py-1">
                          {o.service.uz ?? Object.values(o.service)[0] ?? '—'}
                          <span className="ml-1 text-[10px]">
                            ({t(`sheet.schedules.${o.schedule}`)}
                            {o.timesPerDay > 1
                              ? `, ${t('sheet.perDayShort', { count: o.timesPerDay })}`
                              : ''}
                            )
                          </span>
                        </td>
                        {columnDates.map((date) => {
                          const day = o.days.find((d) => d.date === date);
                          return (
                            <td key={date} className="border border-black px-1 py-1 text-center">
                              {day
                                ? day.slots
                                    .map((sl) =>
                                      sl.status === 'GIVEN' ? '+' : sl.status === 'SKIPPED' ? '−' : '·',
                                    )
                                    .join('')
                                : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            <p className="mt-1 text-[10px]">{tp('sheetLegend')}</p>
          </div>
        ) : null}

        {/* Kundalik */}
        {p.dailyNotes.length > 0 ? (
          <div className="page-break mt-6">
            <h2 className="mb-3 text-center text-[14px] font-bold uppercase">{tp('diaryTitle')}</h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className="w-24 border border-black px-1 py-1">{tp('date')}</th>
                  <th className="border border-black px-1 py-1">{tp('condition')}</th>
                  <th className="w-28 border border-black px-1 py-1">{tp('vitals')}</th>
                </tr>
              </thead>
              <tbody>
                {p.dailyNotes.map((n, i) => (
                  <tr key={i}>
                    <td className="border border-black px-1 py-1 align-top">{formatDate(n.date)}</td>
                    <td className="whitespace-pre-wrap border border-black px-1 py-1 align-top">{n.condition}</td>
                    <td className="border border-black px-1 py-1 align-top text-[11px]">
                      {[
                        n.temperatureC && `t° ${n.temperatureC}`,
                        n.pulseBpm && `Ps ${n.pulseBpm}`,
                        n.bpSystolic && n.bpDiastolic && `${n.bpSystolic}/${n.bpDiastolic}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* Epikriz */}
        <div className="page-break mt-6">
          <h2 className="mb-3 text-center text-[14px] font-bold uppercase">{tp('epicrisisTitle')}</h2>
          <Block title={tp('epicrisis')} value={str('epicrisis')} lines={10} />
        </div>

        {/* Imzolar */}
        <div className="mt-8 grid grid-cols-2 gap-8 text-[13px]">
          <div>
            <p className="border-b border-black pb-4">{p.doctor.fullName ?? ' '}</p>
            <p className="mt-1">{tp('attendingDoctor')}</p>
          </div>
          <div>
            <p className="border-b border-black pb-4">&nbsp;</p>
            <p className="mt-1">{tp('headOfDepartment')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
