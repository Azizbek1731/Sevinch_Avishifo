'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Pill, Stethoscope } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { PortalVisit } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';
import { RecordAccessGate } from '@/components/record-access-gate';

export default function VisitsPage() {
  const authStatus = useRequireAuth();

  const visitsQ = useQuery({
    queryKey: ['portal-visits'],
    queryFn: () => api.get<PortalVisit[]>('/portal/me/visits').then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  if (authStatus !== 'authed') return <PageLoader />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Kasallik tarixi</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tekshiruvdan o&apos;tgan tashriflaringiz: tashxis, tavsiyalar va retseptlar
        </p>
      </div>

      <RecordAccessGate>
        {visitsQ.isPending && <PageLoader />}
        {visitsQ.isError && (
          <EmptyState title="Yuklab bo'lmadi" description={errorMessage(visitsQ.error)} />
        )}
        {visitsQ.data !== undefined &&
          (visitsQ.data.length === 0 ? (
            <EmptyState
              icon={<Stethoscope className="h-10 w-10" />}
              title="Kasallik tarixi hali bo'sh"
              description="Shifokor tekshiruvidan o'tganingizdan so'ng ma'lumotlar shu yerda ko'rinadi"
            />
          ) : (
            <ul className="space-y-3">
              {visitsQ.data.map((visit) => {
                const primary =
                  visit.diagnoses.find((d) => d.isPrimary) ?? visit.diagnoses[0] ?? null;
                return (
                  <li key={visit.id}>
                    <Link
                      href={`/me/visits/${visit.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
                        <Stethoscope className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* The name gets the whole row: sharing it with the date on
                            one line cut Uzbek patronymics to a dozen characters. */}
                        <p className="truncate font-semibold">{visit.doctorName}</p>
                        <p className="truncate text-sm text-slate-500">
                          {formatDate(visit.completedAt ?? visit.startedAt)}
                          {visit.doctorSpecialty ? ` · ${visit.doctorSpecialty}` : ''} ·{' '}
                          {visit.clinicName}
                        </p>
                        {primary !== null && (
                          <p className="mt-1.5 line-clamp-1 text-sm text-slate-700">
                            <span className="font-medium">Tashxis:</span> {primary.nameUz}
                          </p>
                        )}
                        {visit.prescriptionCount > 0 && (
                          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <Pill className="h-3 w-3" />
                            {visit.prescriptionCount} ta retsept
                          </span>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
      </RecordAccessGate>
    </div>
  );
}
