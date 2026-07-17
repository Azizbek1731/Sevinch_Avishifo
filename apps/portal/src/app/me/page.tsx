'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  FlaskConical,
  IdCard,
  ReceiptText,
  Star,
  Stethoscope,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { PortalPatientCard, PortalVisit } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';
import { SectionCard } from '@/components/section-card';

const QUICK_LINKS = [
  { href: '/me/appointments', label: 'Qabullarim', icon: CalendarDays },
  { href: '/me/results', label: 'Natijalarim', icon: FlaskConical },
  { href: '/me/invoices', label: 'Hisoblarim', icon: ReceiptText },
] as const;

export default function CabinetPage() {
  const authStatus = useRequireAuth();

  const cardsQ = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => api.get<PortalPatientCard[]>('/portal/me').then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  const visitsQ = useQuery({
    queryKey: ['portal-visits'],
    queryFn: () => api.get<PortalVisit[]>('/portal/me/visits').then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  if (authStatus !== 'authed') return <PageLoader />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Kabinet</h1>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-2">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:border-brand"
          >
            <link.icon className="h-6 w-6 text-brand" />
            <span className="text-xs font-medium text-slate-700">{link.label}</span>
          </Link>
        ))}
      </div>

      {/* Patient cards */}
      <SectionCard title="Bemor kartalarim">
        {cardsQ.isPending && <PageLoader />}
        {cardsQ.isError && (
          <p className="text-sm text-red-600">{errorMessage(cardsQ.error)}</p>
        )}
        {cardsQ.data !== undefined &&
          (cardsQ.data.length === 0 ? (
            <EmptyState
              icon={<IdCard className="h-10 w-10" />}
              title="Hozircha bemor kartangiz yo'q"
              description="Klinikaga birinchi marta yozilganingizda karta ochiladi"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {cardsQ.data.map((card) => (
                <li key={`${card.clinicId}:${card.patientId}`}>
                  <Link
                    href={`/c/${card.clinicId}`}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <span>
                        <span className="block font-medium">{card.clinicName}</span>
                        <span className="block text-sm text-slate-500">
                          {card.fullName} · {card.mrn}
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </SectionCard>

      {/* Visit history */}
      <SectionCard title="Tashriflar tarixi">
        {visitsQ.isPending && <PageLoader />}
        {visitsQ.isError && <p className="text-sm text-red-600">{errorMessage(visitsQ.error)}</p>}
        {visitsQ.data !== undefined &&
          (visitsQ.data.length === 0 ? (
            <EmptyState
              icon={<Stethoscope className="h-10 w-10" />}
              title="Tashriflar hali yo'q"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {visitsQ.data.map((visit) => (
                <li key={visit.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{visit.doctorName}</p>
                      <p className="text-sm text-slate-500">
                        {visit.clinicName} · {formatDate(visit.date)}
                      </p>
                      {visit.diagnoses.length > 0 && (
                        <p className="mt-1 text-sm text-slate-600">
                          Tashxis: {visit.diagnoses.join(', ')}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/feedback?visitId=${visit.id}`}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-600 transition hover:bg-amber-50"
                    >
                      <Star className="h-3.5 w-3.5" />
                      Baholash
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </SectionCard>
    </div>
  );
}
