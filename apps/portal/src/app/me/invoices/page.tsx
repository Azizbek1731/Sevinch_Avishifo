'use client';

import { useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { compareMoney, formatUZS, subMoney } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import type { PortalInvoice } from '@/lib/types';
import { formatDate } from '@/lib/dates';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { EmptyState } from '@/components/empty-state';
import { PageLoader } from '@/components/spinner';
import { INVOICE_STATUS_CHIP, StatusChip } from '@/components/status-chip';

export default function InvoicesPage() {
  const authStatus = useRequireAuth();

  const invoicesQ = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: () => api.get<PortalInvoice[]>('/portal/me/invoices').then((r) => r.data),
    enabled: authStatus === 'authed',
  });

  if (authStatus !== 'authed') return <PageLoader />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Hisoblarim</h1>

      {invoicesQ.isPending && <PageLoader />}
      {invoicesQ.isError && (
        <EmptyState title="Yuklab bo'lmadi" description={errorMessage(invoicesQ.error)} />
      )}
      {invoicesQ.data !== undefined &&
        (invoicesQ.data.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="h-10 w-10" />}
            title="Hisob-fakturalar hali yo'q"
          />
        ) : (
          <ul className="space-y-3">
            {invoicesQ.data.map((invoice) => {
              const chip = INVOICE_STATUS_CHIP[invoice.status];
              const hasDebt =
                (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') &&
                compareMoney(invoice.paidTotal, invoice.total) < 0;
              return (
                <li
                  key={invoice.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">№ {invoice.number}</p>
                      <p className="truncate text-sm text-slate-500">
                        {formatDate(invoice.date)} · {invoice.clinicName}
                      </p>
                    </div>
                    <StatusChip label={chip.label} tone={chip.tone} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1 border-t border-slate-100 pt-3">
                    <div className="text-sm text-slate-500">
                      To&apos;langan: {formatUZS(invoice.paidTotal)}
                      {hasDebt && (
                        <span className="block font-medium text-red-600">
                          Qoldiq: {formatUZS(subMoney(invoice.total, invoice.paidTotal))}
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-bold text-slate-900">{formatUZS(invoice.total)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
