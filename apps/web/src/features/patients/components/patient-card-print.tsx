'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { API_URL, api } from '@/lib/api-client';
import { formatDate, formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface CardPayload {
  clinic: { name: string; logoUrl: string | null; address: string | null; phone: string | null };
  patient: {
    mrn: string;
    fullName: string;
    dob: string | null;
    gender: string | null;
    address: string | null;
    phone: string | null;
    passportId: string | null;
    bloodGroup: string;
    allergies: unknown;
    chronicConditions: unknown;
    createdAt: string;
  };
  visits: Array<{
    date: string;
    doctor: string;
    subjective: string | null;
    objective: string | null;
    assessmentNote: string | null;
    plan: string | null;
    nextVisitAt: string | null;
    vitals: { temperatureC: number | null; pulseBpm: number | null; bpSystolic: number | null; bpDiastolic: number | null } | null;
    diagnoses: Array<{ code: string; name: string; nameRu: string | null; isPrimary: boolean }>;
    prescriptions: Array<{ drugName: string; dosage: string | null; frequency: string | null; durationDays: number | null }>;
  }>;
}

function Item({ n, label, value }: { n?: string; label: string; value?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex gap-1.5 text-[13px] leading-snug">
      <span className="shrink-0">
        {n ? <span className="font-semibold">{n}. </span> : null}
        {label}
      </span>
      <span className="min-w-0 flex-1 border-b border-dotted border-black px-1">{value || ' '}</span>
    </div>
  );
}

/**
 * Ambulator bemorning tibbiy kartasi — form 025/h.
 *
 * The paper card is one booklet per patient: a title page that is filled once,
 * then every visit written into it in order. This prints the same way, so a
 * clinic can file it or hand it to a patient who is moving to another practice.
 */
export function PatientCardPrint({ patientId }: { patientId: string }) {
  const t = useTranslations('cardPrint');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const query = useQuery({
    queryKey: ['patient', patientId, 'card-print'],
    queryFn: async () => (await api.get<CardPayload>(`/patients/${patientId}/card-print`)).data,
  });

  if (query.isLoading) return <Skeleton className="h-[60vh] w-full" />;
  const p = query.data;
  if (!p) return null;

  const logoSrc = p.clinic.logoUrl
    ? p.clinic.logoUrl.startsWith('http')
      ? p.clinic.logoUrl
      : `${API_URL}${p.clinic.logoUrl}`
    : null;
  const allergies = Array.isArray(p.patient.allergies)
    ? (p.patient.allergies as Array<{ name: string }>).map((x) => x.name).join(', ')
    : '';
  const chronic = Array.isArray(p.patient.chronicConditions)
    ? (p.patient.chronicConditions as string[]).join(', ')
    : '';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button variant="outline" asChild>
          <Link href={`/patients/${patientId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {tCommon('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          {tCommon('print')}
        </Button>
      </div>

      <div className="print-area print-flow rounded-md border bg-white p-8 text-black shadow-sm">
        <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div className="flex items-start gap-3">
            {logoSrc ? (
              /* Plain img: the logo comes from the API host and must render for print. */
              <img src={logoSrc} alt="" className="h-12 w-12 object-contain" />
            ) : null}
            <div className="text-[12px] leading-tight">
              <p className="font-semibold">{t('ministry')}</p>
              <p className="text-[13px] font-bold">{p.clinic.name}</p>
              {p.clinic.address ? <p>{p.clinic.address}</p> : null}
              {p.clinic.phone ? <p>{p.clinic.phone}</p> : null}
            </div>
          </div>
          <div className="shrink-0 border border-black px-2 py-1 text-center text-[11px] leading-tight">
            <p>{t('docLabel')}</p>
            <p className="font-bold">{t('formNo')}</p>
          </div>
        </header>

        <h1 className="mb-1 text-center text-[15px] font-bold uppercase">{t('title')}</h1>
        <p className="mb-4 text-center text-[13px]">
          № <span className="font-bold">{p.patient.mrn}</span>
        </p>

        <Item n="1" label={t('fullName')} value={p.patient.fullName} />
        <div className="grid grid-cols-2 gap-x-8">
          <Item n="2" label={t('gender')} value={p.patient.gender ? t(`genders.${p.patient.gender}`) : ''} />
          <Item n="3" label={t('dob')} value={p.patient.dob ? formatDate(p.patient.dob) : ''} />
        </div>
        <Item n="4" label={t('address')} value={[p.patient.address, p.patient.phone].filter(Boolean).join(', ')} />
        <Item n="5" label={t('passport')} value={p.patient.passportId ?? ''} />
        <Item n="6" label={t('registeredAt')} value={formatDate(p.patient.createdAt)} />

        <div className="mt-4 border border-black p-2">
          <p className="mb-1 text-[12px] font-bold uppercase">{t('signalMarks')}</p>
          <Item label={t('bloodGroup')} value={p.patient.bloodGroup === 'UNKNOWN' ? '' : p.patient.bloodGroup} />
          <Item label={t('allergy')} value={allergies} />
          <Item label={t('chronic')} value={chronic} />
        </div>

        <div className="page-break mt-6">
          <h2 className="mb-3 text-center text-[14px] font-bold uppercase">{t('visitsTitle')}</h2>
          {p.visits.length === 0 ? (
            <p className="text-center text-[13px]">{t('noVisits')}</p>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="w-20 border border-black px-1 py-1">{t('date')}</th>
                  <th className="border border-black px-1 py-1">{t('record')}</th>
                  <th className="w-40 border border-black px-1 py-1">{t('diagnosis')}</th>
                  <th className="w-32 border border-black px-1 py-1">{t('doctor')}</th>
                </tr>
              </thead>
              <tbody>
                {p.visits.map((v, i) => (
                  <tr key={i}>
                    <td className="border border-black px-1 py-1 align-top">{formatTz(v.date)}</td>
                    <td className="border border-black px-1 py-1 align-top">
                      {[
                        v.subjective && `${t('complaints')}: ${v.subjective}`,
                        v.objective && `${t('objective')}: ${v.objective}`,
                        v.vitals &&
                          [
                            v.vitals.temperatureC && `t° ${v.vitals.temperatureC}`,
                            v.vitals.pulseBpm && `Ps ${v.vitals.pulseBpm}`,
                            v.vitals.bpSystolic && v.vitals.bpDiastolic && `AD ${v.vitals.bpSystolic}/${v.vitals.bpDiastolic}`,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        v.plan && `${t('plan')}: ${v.plan}`,
                        v.prescriptions.length > 0 &&
                          `${t('prescriptions')}: ${v.prescriptions
                            .map((rx) => [rx.drugName, rx.dosage, rx.frequency].filter(Boolean).join(' '))
                            .join('; ')}`,
                        v.nextVisitAt && `${t('nextVisit')}: ${formatDate(v.nextVisitAt)}`,
                      ]
                        .filter(Boolean)
                        .map((line, k) => (
                          <p key={k} className="whitespace-pre-wrap">
                            {line}
                          </p>
                        ))}
                    </td>
                    <td className="border border-black px-1 py-1 align-top">
                      {v.diagnoses.map((d, k) => (
                        <p key={k}>
                          {d.code} — {locale === 'ru' && d.nameRu ? d.nameRu : d.name}
                        </p>
                      ))}
                    </td>
                    <td className="border border-black px-1 py-1 align-top">{v.doctor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
