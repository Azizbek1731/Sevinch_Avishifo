'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileText,
  HeartPulse,
  Pill,
  Printer,
  Send,
  Stethoscope,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { PortalVisitDetail, PortalVitals } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';

function vitalRows(v: PortalVitals): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (v.bpSystolic !== null && v.bpDiastolic !== null)
    rows.push({ label: 'Qon bosimi', value: `${v.bpSystolic}/${v.bpDiastolic} mm` });
  if (v.pulseBpm !== null) rows.push({ label: 'Puls', value: `${v.pulseBpm} zarba/daq` });
  if (v.temperatureC !== null) rows.push({ label: 'Harorat', value: `${v.temperatureC} °C` });
  if (v.spo2 !== null) rows.push({ label: 'SpO₂', value: `${v.spo2}%` });
  if (v.weightKg !== null) rows.push({ label: 'Vazn', value: `${v.weightKg} kg` });
  if (v.heightCm !== null) rows.push({ label: "Bo'y", value: `${v.heightCm} sm` });
  return rows;
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        <span className="text-brand">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const authStatus = useRequireAuth();

  const visitQ = useQuery({
    queryKey: ['portal-visit', id],
    queryFn: () => api.get<PortalVisitDetail>(`/portal/me/visits/${id}`).then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  if (authStatus !== 'authed') return <PageLoader />;
  if (visitQ.isPending) return <PageLoader />;
  if (visitQ.isError || visitQ.data === undefined) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EmptyState
          title="Ma'lumot topilmadi"
          description={visitQ.error ? errorMessage(visitQ.error) : undefined}
        />
      </div>
    );
  }

  const v = visitQ.data;
  const vitals = v.vitals ? vitalRows(v.vitals) : [];
  const date = formatDate(v.completedAt ?? v.startedAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <BackLink />
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          <Printer className="h-4 w-4" />
          Chop etish
        </button>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
            <Stethoscope className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{v.doctorName}</p>
            <p className="text-sm text-slate-500">
              {v.doctorSpecialty ? `${v.doctorSpecialty} · ` : ''}
              {v.clinicName}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-700">{date}</p>
          </div>
        </div>
      </div>

      {/* Diagnoses */}
      {v.diagnoses.length > 0 && (
        <Section icon={<ClipboardList className="h-4 w-4" />} title="Tashxis">
          <ul className="space-y-2">
            {v.diagnoses.map((d) => (
              <li key={d.code} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500">
                  {d.code}
                </span>
                <span className="text-sm text-slate-800">
                  {d.nameUz}
                  {d.isPrimary && (
                    <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand">
                      asosiy
                    </span>
                  )}
                  {d.note && <span className="block text-slate-500">{d.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Prescriptions */}
      {v.prescriptions.length > 0 && (
        <Section icon={<Pill className="h-4 w-4" />} title="Retseptlar">
          <ul className="space-y-3">
            {v.prescriptions.map((p, i) => (
              <li key={i} className="rounded-xl bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">{p.drugName}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-600">
                  {p.dosage && <span>{p.dosage}</span>}
                  {p.frequency && <span>{p.frequency}</span>}
                  {p.durationDays !== null && <span>{p.durationDays} kun</span>}
                </div>
                {p.instructions && <p className="mt-1 text-sm text-slate-500">{p.instructions}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Recommendations (plan) */}
      {v.plan && (
        <Section icon={<FileText className="h-4 w-4" />} title="Tavsiyalar">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{v.plan}</p>
        </Section>
      )}

      {/* Complaints (subjective) */}
      {v.subjective && (
        <Section icon={<FileText className="h-4 w-4" />} title="Shikoyatlar va anamnez">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
            {v.subjective}
          </p>
        </Section>
      )}

      {/* Examination (objective) */}
      {v.objective && (
        <Section icon={<Activity className="h-4 w-4" />} title="Ko'rik">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
            {v.objective}
          </p>
        </Section>
      )}

      {/* Vitals */}
      {vitals.length > 0 && (
        <Section icon={<HeartPulse className="h-4 w-4" />} title="Ko'rsatkichlar">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {vitals.map((row) => (
              <div key={row.label} className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">{row.label}</p>
                <p className="font-semibold text-slate-900">{row.value}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Referrals */}
      {v.referrals.length > 0 && (
        <Section icon={<Send className="h-4 w-4" />} title="Yo'llanmalar">
          <ul className="space-y-1 text-sm text-slate-700">
            {v.referrals.map((r, i) => (
              <li key={i}>
                {r.type === 'LAB' ? 'Laboratoriyaga' : 'Mutaxassisga'}
                {r.targetSpecialty ? ` — ${r.targetSpecialty}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Next visit */}
      {v.nextVisitAt && (
        <div className="flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand-light px-4 py-3 text-sm font-medium text-brand-dark">
          <CalendarClock className="h-5 w-5 shrink-0" />
          Keyingi tashrif: {formatDate(v.nextVisitAt)}
        </div>
      )}

      {/* Feedback CTA */}
      <Link
        href={`/feedback?visitId=${v.id}`}
        className="flex items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 print:hidden"
      >
        Tashrifni baholash
      </Link>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/me/visits"
      className="-ml-2 flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium text-slate-600 transition hover:text-brand"
    >
      <ArrowLeft className="h-4 w-4" />
      Kasallik tarixi
    </Link>
  );
}
