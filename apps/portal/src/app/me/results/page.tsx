'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FlaskConical } from 'lucide-react';
import type { ResultFlag } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import type { PortalLabResult } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';

const FLAG_META: Record<ResultFlag, { short: string; className: string } | null> = {
  NORMAL: null,
  HIGH: { short: 'H', className: 'bg-red-50 text-red-600' },
  LOW: { short: 'L', className: 'bg-blue-50 text-blue-600' },
  ABNORMAL: { short: 'A', className: 'bg-amber-50 text-amber-700' },
};

function valueClass(flag: ResultFlag | null): string {
  if (flag === 'HIGH') return 'font-semibold text-red-600';
  if (flag === 'LOW') return 'font-semibold text-blue-600';
  if (flag === 'ABNORMAL') return 'font-semibold text-amber-700';
  return 'text-slate-900';
}

export default function ResultsPage() {
  const authStatus = useRequireAuth();
  const [openId, setOpenId] = useState<string | null>(null);

  const resultsQ = useQuery({
    queryKey: ['portal-lab-results'],
    queryFn: () => api.get<PortalLabResult[]>('/portal/me/lab-results').then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  if (authStatus !== 'authed') return <PageLoader />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Natijalarim</h1>

      {resultsQ.isPending && <PageLoader />}
      {resultsQ.isError && (
        <EmptyState title="Yuklab bo'lmadi" description={errorMessage(resultsQ.error)} />
      )}
      {resultsQ.data !== undefined &&
        (resultsQ.data.length === 0 ? (
          <EmptyState
            icon={<FlaskConical className="h-10 w-10" />}
            title="Tahlil natijalari hali yo'q"
            description="Natijalar tayyor bo'lganda shu yerda ko'rinadi"
          />
        ) : (
          <ul className="space-y-3">
            {resultsQ.data.map((order) => {
              const isOpen = openId === order.id;
              return (
                <li
                  key={order.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenId(isOpen ? null : order.id)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
                        <FlaskConical className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold">№ {order.orderNumber}</span>
                        {/* Date first, clamped: a long clinic name used to push the
                            header to four lines and bury the date under it. */}
                        <span className="line-clamp-2 text-sm text-slate-500">
                          {formatDate(order.date)} · {order.clinicName}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="space-y-4 border-t border-slate-100 p-4">
                      {order.items.map((item) => (
                        <div key={item.testName}>
                          <p className="mb-1 font-medium">{item.testName}</p>
                          {/* Rows, not a table: at 375px a four-column table can
                              only be read by scrolling it sideways. */}
                          <ul className="text-sm">
                            {item.values.map((v) => {
                              const flagMeta = v.flag !== null ? FLAG_META[v.flag] : null;
                              return (
                                <li
                                  key={v.parameter}
                                  className="flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 py-2 last:border-0"
                                >
                                  <span className="min-w-0 flex-1 break-words text-slate-600">
                                    {v.parameter}
                                  </span>
                                  <span className={valueClass(v.flag)}>
                                    {v.value}
                                    {v.unit !== null && v.unit !== '' && (
                                      <span className="ml-1 text-xs font-normal text-slate-400">
                                        {v.unit}
                                      </span>
                                    )}
                                  </span>
                                  {flagMeta !== null && (
                                    <span
                                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold ${flagMeta.className}`}
                                    >
                                      {flagMeta.short}
                                    </span>
                                  )}
                                  {v.referenceText !== null && v.referenceText !== '' && (
                                    <span className="w-full text-xs text-slate-400 sm:w-auto sm:pl-2">
                                      Norma: {v.referenceText}
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
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
