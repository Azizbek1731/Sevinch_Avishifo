'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Lock, Send, ShieldOff } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { PageLoader } from '@/components/spinner';

export interface RecordAccessClinic {
  clinicId: string;
  clinicName: string;
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  requestedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canViewHistory: boolean;
  visitCount: number;
}

/**
 * Shown above the visit list when no clinic has released the patient's history
 * yet. Lab results are unaffected — this gate is only about diagnoses,
 * prescriptions and the doctor's notes, which a clinic releases deliberately.
 *
 * Access is per clinic: a patient treated in two places asks each one.
 */
export function RecordAccessGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);

  const accessQ = useQuery({
    queryKey: ['portal-record-access'],
    queryFn: () =>
      api.get<RecordAccessClinic[]>('/portal/me/record-access').then((r) => r.data),
  });

  const request = useMutation({
    mutationFn: (clinicId: string) =>
      api.post(`/portal/me/record-access/${clinicId}`, note.trim() ? { note: note.trim() } : {}),
    onSuccess: async () => {
      setOpenFor(null);
      setNote('');
      await qc.invalidateQueries({ queryKey: ['portal-record-access'] });
    },
  });

  if (accessQ.isPending) return <PageLoader />;

  const clinics = accessQ.data ?? [];
  const anyApproved = clinics.some((c) => c.canViewHistory);

  return (
    <div className="space-y-4">
      {clinics
        .filter((c) => !c.canViewHistory)
        .map((c) => (
          <div
            key={c.clinicId}
            className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                {c.status === 'PENDING' ? (
                  <Clock className="h-5 w-5" />
                ) : c.status === 'REJECTED' || c.status === 'REVOKED' ? (
                  <ShieldOff className="h-5 w-5" />
                ) : (
                  <Lock className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.clinicName}</p>

                {c.status === 'PENDING' ? (
                  <p className="mt-1 text-sm text-slate-500">
                    So&apos;rovingiz yuborilgan
                    {c.requestedAt ? ` — ${formatDate(c.requestedAt)}` : ''}. Shifokor yoki
                    administrator tasdiqlagach, kasallik tarixingiz shu yerda ochiladi.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    {c.status === 'REJECTED'
                      ? 'So‘rovingiz rad etilgan. Qayta so‘rov yuborishingiz mumkin.'
                      : c.status === 'REVOKED'
                        ? 'Ruxsat bekor qilingan. Qayta so‘rov yuborishingiz mumkin.'
                        : 'Kasallik tarixini ko‘rish uchun klinikadan ruxsat kerak.'}
                    {c.decisionNote ? ` Izoh: ${c.decisionNote}` : ''}
                  </p>
                )}

                {c.status !== 'PENDING' && (
                  <div className="mt-3">
                    {openFor === c.clinicId ? (
                      <div className="space-y-2">
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value.slice(0, 500))}
                          rows={2}
                          placeholder="Izoh (ixtiyoriy)"
                          // text-base, not text-sm: iOS Safari zooms the page in
                          // when a focused field is under 16px.
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base outline-none focus:border-brand"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={request.isPending}
                            onClick={() => request.mutate(c.clinicId)}
                            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            <Send className="h-4 w-4" />
                            {request.isPending ? 'Yuborilmoqda…' : 'So‘rov yuborish'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenFor(null);
                              setNote('');
                            }}
                            className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium"
                          >
                            Bekor qilish
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenFor(c.clinicId)}
                        className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white"
                      >
                        <Send className="h-4 w-4" />
                        Ruxsat so&apos;rash
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

      {request.isError && (
        <p className="text-sm text-red-600">{errorMessage(request.error)}</p>
      )}

      {clinics
        .filter((c) => c.canViewHistory)
        .map((c) => (
          <p key={c.clinicId} className="flex items-center gap-1.5 text-sm text-emerald-600">
            <Check className="h-4 w-4" />
            {c.clinicName} — ruxsat berilgan
          </p>
        ))}

      {anyApproved ? children : null}
    </div>
  );
}
