'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { PortalAppointment } from '@/lib/types';
import { formatDateTime } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader, Spinner } from '@/components/spinner';
import { APPOINTMENT_STATUS_CHIP, StatusChip } from '@/components/status-chip';

type Scope = 'upcoming' | 'past';

const CANCEL_MIN_LEAD_MS = 2 * 60 * 60 * 1000;

function canCancel(a: PortalAppointment): boolean {
  return (
    (a.status === 'SCHEDULED' || a.status === 'CONFIRMED') &&
    new Date(a.startAt).getTime() - Date.now() > CANCEL_MIN_LEAD_MS
  );
}

export default function AppointmentsPage() {
  const authStatus = useRequireAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>('upcoming');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const appointmentsQ = useQuery({
    queryKey: ['portal-appointments', scope],
    queryFn: () =>
      api.get<PortalAppointment[]>('/portal/me/appointments', { scope }).then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/portal/appointments/${id}/cancel`),
    onSuccess: () => {
      toast.success('Qabul bekor qilindi');
      setConfirmingId(null);
      void queryClient.invalidateQueries({ queryKey: ['portal-appointments'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setConfirmingId(null);
    },
  });

  if (authStatus !== 'authed') return <PageLoader />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Qabullarim</h1>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            { value: 'upcoming', label: 'Kelgusi' },
            { value: 'past', label: "O'tgan" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setScope(tab.value)}
            className={`h-9 rounded-lg text-sm font-medium transition ${
              scope === tab.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {appointmentsQ.isPending && <PageLoader />}
      {appointmentsQ.isError && (
        <EmptyState title="Yuklab bo'lmadi" description={errorMessage(appointmentsQ.error)} />
      )}
      {appointmentsQ.data !== undefined &&
        (appointmentsQ.data.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-10 w-10" />}
            title={scope === 'upcoming' ? "Kelgusi qabullar yo'q" : "O'tgan qabullar yo'q"}
            description={scope === 'upcoming' ? 'Klinika sahifasidan qabulga yoziling' : undefined}
            action={
              scope === 'upcoming' ? (
                <Link href="/" className="font-medium text-brand hover:text-brand-dark">
                  Bosh sahifaga o&apos;tish
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {appointmentsQ.data.map((a) => {
              const chip = APPOINTMENT_STATUS_CHIP[a.status];
              return (
                <li
                  key={a.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{a.doctorName}</p>
                      <p className="text-sm text-slate-500">{a.clinicName}</p>
                      <p className="mt-1 text-sm font-medium text-brand-dark">
                        {formatDateTime(a.startAt)}
                      </p>
                    </div>
                    <StatusChip label={chip.label} tone={chip.tone} />
                  </div>
                  {scope === 'upcoming' && canCancel(a) && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      {confirmingId === a.id ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-slate-600">
                            Qabulni bekor qilishni tasdiqlaysizmi?
                          </span>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              disabled={cancel.isPending}
                              onClick={() => cancel.mutate(a.id)}
                              className="flex h-8 items-center gap-1 rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                            >
                              {cancel.isPending && <Spinner className="h-3.5 w-3.5 text-white" />}
                              Ha
                            </button>
                            <button
                              type="button"
                              disabled={cancel.isPending}
                              onClick={() => setConfirmingId(null)}
                              className="h-8 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Yo&apos;q
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(a.id)}
                          className="text-sm font-medium text-red-600 transition hover:text-red-700"
                        >
                          Bekor qilish
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
