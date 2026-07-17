'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarPlus, Clock, MapPin, Phone } from 'lucide-react';
import { formatPhone, formatUZS } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import type { PortalClinicInfo } from '@/lib/types';
import { formatWorkingHours } from '@/lib/dates';
import { Avatar, initialsOf, resolveAssetUrl } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';
import { SectionCard } from '@/components/section-card';

export default function ClinicPage() {
  const { clinicId } = useParams<{ clinicId: string }>();

  const clinicQ = useQuery({
    queryKey: ['portal-clinic', clinicId],
    queryFn: () => api.get<PortalClinicInfo>(`/portal/clinics/${clinicId}`).then((r) => r.data),
    enabled: typeof clinicId === 'string' && clinicId !== '',
  });

  if (clinicQ.isPending) return <PageLoader />;
  if (clinicQ.isError) {
    return (
      <EmptyState
        icon={<Building2 className="h-10 w-10" />}
        title="Klinika topilmadi"
        description={errorMessage(clinicQ.error)}
        action={
          <Link href="/" className="font-medium text-brand hover:text-brand-dark">
            Bosh sahifaga qaytish
          </Link>
        }
      />
    );
  }

  const { clinic, branches, doctors, services } = clinicQ.data;

  return (
    <div className="space-y-5 pb-16">
      {/* About */}
      <section className="flex items-start gap-4">
        {clinic.logoUrl !== null && clinic.logoUrl !== '' ? (
          <img
            src={resolveAssetUrl(clinic.logoUrl)}
            alt={clinic.name}
            className="h-16 w-16 rounded-2xl border border-slate-200 bg-white object-contain p-1"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-light text-2xl font-bold text-brand-dark">
            {initialsOf(clinic.name)}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{clinic.name}</h1>
          {clinic.address !== null && clinic.address !== '' && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <MapPin className="h-4 w-4 shrink-0" />
              {clinic.address}
            </p>
          )}
          {clinic.phone !== null && clinic.phone !== '' && (
            <a
              href={`tel:${clinic.phone}`}
              className="mt-1 flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-dark"
            >
              <Phone className="h-4 w-4 shrink-0" />
              {formatPhone(clinic.phone)}
            </a>
          )}
        </div>
      </section>

      {/* Branches */}
      <SectionCard title="Filiallar">
        {branches.length === 0 ? (
          <p className="text-sm text-slate-500">Filiallar haqida ma&apos;lumot yo&apos;q</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {branches.map((branch) => {
              const hours = formatWorkingHours(branch.workingHours);
              return (
                <li key={branch.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-medium">{branch.name}</p>
                  {branch.address !== null && branch.address !== '' && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                      <MapPin className="h-4 w-4 shrink-0" />
                      {branch.address}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                    {branch.phone !== null && branch.phone !== '' && (
                      <a
                        href={`tel:${branch.phone}`}
                        className="flex items-center gap-1.5 font-medium text-brand hover:text-brand-dark"
                      >
                        <Phone className="h-4 w-4 shrink-0" />
                        {formatPhone(branch.phone)}
                      </a>
                    )}
                    {hours !== null && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4 shrink-0" />
                        {hours}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Doctors */}
      <SectionCard title="Shifokorlar">
        {doctors.length === 0 ? (
          <p className="text-sm text-slate-500">Shifokorlar haqida ma&apos;lumot yo&apos;q</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {doctors.map((doctor) => (
              <div
                key={doctor.userId}
                className="flex flex-col items-center rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-center"
              >
                <Avatar name={doctor.fullName} photoUrl={doctor.photoUrl} />
                <p className="mt-2 text-sm font-semibold leading-snug">{doctor.fullName}</p>
                {doctor.specialty !== null && doctor.specialty !== '' && (
                  <p className="mt-0.5 text-xs text-slate-500">{doctor.specialty}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Services */}
      <SectionCard title="Xizmatlar va narxlar">
        {services.length === 0 ? (
          <p className="text-sm text-slate-500">Xizmatlar haqida ma&apos;lumot yo&apos;q</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {services.map((service) => (
              <li key={service.id} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm">{service.name.uz}</span>
                <span className="shrink-0 text-sm font-semibold text-slate-900">
                  {formatUZS(service.price)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Sticky booking CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <Link
            href={`/c/${clinicId}/book`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark"
          >
            <CalendarPlus className="h-5 w-5" />
            Qabulga yozilish
          </Link>
        </div>
      </div>
    </div>
  );
}
