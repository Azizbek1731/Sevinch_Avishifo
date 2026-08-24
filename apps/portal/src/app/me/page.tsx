'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  FileText,
  FlaskConical,
  IdCard,
  ReceiptText,
  Stethoscope,
} from 'lucide-react';
import { formatPhone } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import type { PortalPatientCard, PortalVisit } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { useProfile } from '@/hooks/use-profile';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';
import { SectionCard } from '@/components/section-card';

const QUICK_LINKS = [
  { href: '/me/appointments', label: 'Qabullarim', icon: CalendarDays },
  { href: '/me/visits', label: 'Kasallik tarixi', icon: Stethoscope },
  { href: '/me/results', label: 'Natijalarim', icon: FlaskConical },
  { href: '/me/documents', label: 'Hujjatlarim', icon: FileText },
  { href: '/me/invoices', label: 'Hisoblarim', icon: ReceiptText },
] as const;

export default function CabinetPage() {
  const authStatus = useRequireAuth();

  const profileQ = useProfile(authStatus === 'authed');

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

      {/* Profile summary → full profile */}
      <Link href="/me/profile" className="block">
        <SectionCard className="transition hover:border-brand">
          <div className="flex items-center gap-4">
            <Avatar name={profileQ.data?.fullName || profileQ.data?.phone || 'A'} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">
                {profileQ.data?.fullName || 'Profilingiz'}
              </p>
              <p className="truncate text-sm text-slate-500">
                {profileQ.data ? formatPhone(profileQ.data.phone) : 'Profilni to‘ldiring'}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </div>
        </SectionCard>
      </Link>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {QUICK_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-surface p-3 text-center shadow-sm transition hover:border-brand"
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
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{card.clinicName}</span>
                        {/* Card number first — it is what reception asks for, and the
                            patient's own name is already at the top of this screen. */}
                        <span className="block truncate text-sm text-slate-500">
                          {card.mrn} · {card.fullName}
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

      {/* Visit history (medical records) */}
      <SectionCard
        title="Kasallik tarixi"
        action={
          visitsQ.data !== undefined && visitsQ.data.length > 0 ? (
            <Link
              href="/me/visits"
              className="-my-2 inline-flex min-h-11 items-center px-2 text-sm font-medium text-brand hover:underline"
            >
              Barchasi
            </Link>
          ) : undefined
        }
      >
        {visitsQ.isPending && <PageLoader />}
        {visitsQ.isError && <p className="text-sm text-red-600">{errorMessage(visitsQ.error)}</p>}
        {visitsQ.data !== undefined &&
          (visitsQ.data.length === 0 ? (
            <EmptyState
              icon={<Stethoscope className="h-10 w-10" />}
              title="Kasallik tarixi hali bo'sh"
              description="Shifokor tekshiruvidan so'ng shu yerda ko'rinadi"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {visitsQ.data.slice(0, 5).map((visit) => {
                const primary =
                  visit.diagnoses.find((d) => d.isPrimary) ?? visit.diagnoses[0] ?? null;
                return (
                  <li key={visit.id}>
                    <Link
                      href={`/me/visits/${visit.id}`}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{visit.doctorName}</p>
                        <p className="truncate text-sm text-slate-500">
                          {formatDate(visit.completedAt ?? visit.startedAt)} · {visit.clinicName}
                        </p>
                        {primary !== null && (
                          <p className="mt-1 line-clamp-1 text-sm text-slate-600">
                            Tashxis: {primary.nameUz}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
      </SectionCard>
    </div>
  );
}
