'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, ReceiptText } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi } from '../api';
import { usePermission } from '../hooks';
import { VoidPaymentButton } from './void-payment-button';

const PREVIEW = 5;

/**
 * What this drawer has taken, so a wrong entry can be undone where it happened.
 *
 * Undoing a payment has existed for a while, but only inside the invoice — and
 * a paid invoice leaves the cashier's pending list the moment it is settled. At
 * the exact moment somebody notices they keyed in the wrong amount, there was
 * no way to reach it from this screen at all.
 */
export function ShiftPaymentsCard() {
  const t = useTranslations('cashier');
  const tb = useTranslations('billing');
  const can = usePermission();
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'current', 'payments'],
    queryFn: async () => (await billingApi.currentShiftPayments()).data,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  const rows = data ?? [];
  if (rows.length === 0) return null;

  const shown = expanded ? rows : rows.slice(0, PREVIEW);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ReceiptText className="h-4 w-4 text-muted-foreground" />
            {t('payments.title')}
          </p>
          <span className="text-xs text-muted-foreground">
            {t('payments.count', { count: rows.length })}
          </span>
        </div>

        <ul className="divide-y">
          {shown.map((p) => {
            const voided = p.status === 'VOIDED';
            return (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm">
                    <Link
                      href={`/invoices/${p.invoiceId}`}
                      className={`truncate hover:underline${voided ? ' text-muted-foreground line-through' : ''}`}
                    >
                      {p.patientName ?? p.invoiceNumber}
                    </Link>
                    {voided ? (
                      <Badge variant="outline" className="shrink-0">
                        {t('payments.voided')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tb(`methods.${p.method}`)} · {formatTz(p.paidAt)}
                  </p>
                  {p.note ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {tb('pay.note')}: {p.note}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap font-medium tabular-nums${
                    voided ? ' text-muted-foreground line-through' : ''
                  }`}
                >
                  {formatUZS(p.amount)}
                </span>
                {!voided && can('payments.void') ? <VoidPaymentButton payment={p} /> : <span className="w-9" />}
              </li>
            );
          })}
        </ul>

        {rows.length > PREVIEW ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="mr-1 h-4 w-4" />
                {t('payments.showLess')}
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 h-4 w-4" />
                {t('payments.showAll', { count: rows.length })}
              </>
            )}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
