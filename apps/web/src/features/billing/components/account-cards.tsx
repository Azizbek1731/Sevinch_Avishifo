'use client';

import { useTranslations } from 'next-intl';
import { Banknote, CreditCard, Smartphone } from 'lucide-react';
import { formatUZS, toTiyin } from '@avishifo/shared';
import { Card, CardContent } from '@/components/ui/card';
import type { CashAccount, CashAccountMethod } from '../api';

export const ACCOUNT_ICONS = { CASH: Banknote, CARD: CreditCard, CLICK: Smartphone };
const ACCOUNT_STYLES: Record<CashAccountMethod, string> = {
  CASH: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20',
  CARD: 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20',
  CLICK: 'border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20',
};
const METRICS = ['opening', 'receipts', 'deposits', 'refunds', 'expenses'] as const;

export function AccountCards({ accounts }: { accounts: CashAccount[] }) {
  const t = useTranslations('billing');
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {accounts.map((account) => {
        const Icon = ACCOUNT_ICONS[account.method];
        return (
          <Card key={account.method} className={ACCOUNT_STYLES[account.method]}>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{t(`accounts.${account.method}`)}</p>
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight tabular-nums">
                  {formatUZS(account.expected)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t('accounts.expected')}</p>
              </div>
              <dl className="space-y-2 border-t pt-3 text-sm">
                {METRICS.map((metric) => (
                  <div key={metric} className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{t(`accounts.${metric}`)}</dt>
                    <dd
                      className={`font-medium tabular-nums ${(metric === 'refunds' || metric === 'expenses') && toTiyin(account[metric]) > 0n ? 'text-destructive' : ''}`}
                    >
                      {(metric === 'refunds' || metric === 'expenses') &&
                      toTiyin(account[metric]) > 0n
                        ? '−'
                        : ''}
                      {formatUZS(account[metric], { withCurrency: false })}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
