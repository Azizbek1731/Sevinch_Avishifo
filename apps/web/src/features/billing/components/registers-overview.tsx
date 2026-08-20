'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Banknote, CreditCard, Globe, Users } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { billingApi } from '../api';

/**
 * Every open register in the branch, for the people who supervise them.
 *
 * This screen exists because the clinic's own money had no home. A cashier's
 * panel shows one person's drawer; the dashboard showed only a count of open
 * shifts with no names and no amounts. An owner who wanted to know what the
 * clinic had taken could only open a drawer of their own — and then read their
 * own empty one as the answer.
 */
export function RegistersOverviewPage() {
  const t = useTranslations('cashier');
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'overview', activeBranchId],
    queryFn: async () => (await billingApi.registersOverview()).data,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('overview.title')} description={t('overview.description')} />

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.registers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t('overview.noneOpen')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary
              icon={<Banknote className="h-5 w-5" />}
              tone="success"
              label={t('overview.totalCash')}
              value={formatUZS(data.totals.expectedCash)}
              hint={t('overview.totalCashHint')}
            />
            <Summary
              icon={<CreditCard className="h-5 w-5" />}
              tone="primary"
              label={t('overview.totalTransfer')}
              value={formatUZS(data.totals.transferTotal)}
              hint={t('overview.totalTransferHint')}
            />
            <Summary
              icon={<Users className="h-5 w-5" />}
              tone="muted"
              label={t('overview.openDrawers')}
              value={String(data.totals.openDrawers)}
              hint={t('overview.openDrawersHint')}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('overview.cashier')}</TableHead>
                    <TableHead>{t('overview.openedAt')}</TableHead>
                    <TableHead className="text-right">{t('shift.openingCash')}</TableHead>
                    <TableHead className="text-right">{t('overview.cash')}</TableHead>
                    <TableHead className="text-right">{t('overview.transfer')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.registers.map((r) => (
                    <TableRow key={r.shiftId}>
                      <TableCell className="font-medium">{r.cashier.fullName}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTz(r.openedAt)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatUZS(r.openingCash, { withCurrency: false })}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatUZS(r.expectedCash, { withCurrency: false })}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatUZS(r.transferTotal, { withCurrency: false })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {Number(data.unattachedOnlineToday) > 0 ? (
            <Card>
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <Globe className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">
                    {t('overview.unattached')}: {formatUZS(data.unattachedOnlineToday)}
                  </p>
                  {/* Money that arrived with nobody at the desk. Assigning it to
                      whoever happened to have a drawer open would make it
                      impossible for that person to ever balance. */}
                  <p className="mt-1 text-muted-foreground">{t('overview.unattachedHint')}</p>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function Summary({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  tone: 'success' | 'primary' | 'muted';
  label: string;
  value: string;
  hint: string;
}) {
  const ring =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'primary'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground';
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ring}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
