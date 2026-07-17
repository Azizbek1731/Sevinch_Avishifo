'use client';

import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Banknote, ReceiptText } from 'lucide-react';
import { formatUZS, InvoiceStatus } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi, type InvoiceListItem } from '../api';
import { usePermission } from '../hooks';
import { PayDialog } from './pay-dialog';

const PENDING_STATUSES = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] as const;

export function PendingInvoicesTab() {
  const t = useTranslations('cashier');
  const tb = useTranslations('billing');
  const can = usePermission();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const [paying, setPaying] = useState<InvoiceListItem | null>(null);

  const results = useQueries({
    queries: PENDING_STATUSES.map((status) => ({
      queryKey: ['invoices', { pending: status, branchId: activeBranchId }],
      queryFn: async () =>
        (
          await billingApi.listInvoices({
            status,
            branchId: activeBranchId ?? undefined,
            limit: 50,
          })
        ).data,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const invoices = useMemo(
    () =>
      results
        .flatMap((r) => r.data ?? [])
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [results],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title={t('pending.empty')}
        description={t('pending.emptyDesc')}
      />
    );
  }

  return (
    <div className="space-y-3">
      {invoices.map((inv) => (
        <Card key={inv.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/invoices/${inv.id}`}
                  className="font-semibold text-primary hover:underline"
                >
                  {inv.number}
                </Link>
                <StatusBadge status={inv.status} label={tb(`statuses.${inv.status}`)} />
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {inv.patient.fullName} · {formatTz(inv.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{tb('cols.due')}</p>
                <p className="text-lg font-bold text-destructive">{formatUZS(inv.due)}</p>
              </div>
              {can('payments.create') ? (
                <Button size="lg" onClick={() => setPaying(inv)}>
                  <Banknote className="mr-1 h-5 w-5" />
                  {t('pending.pay')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}

      {paying ? (
        <PayDialog
          open={paying !== null}
          onOpenChange={(o) => !o && setPaying(null)}
          invoice={{ id: paying.id, number: paying.number, due: paying.due }}
        />
      ) : null}
    </div>
  );
}
