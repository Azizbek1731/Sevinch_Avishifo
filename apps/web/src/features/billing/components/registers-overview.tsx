'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Globe } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
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
import { AccountCards } from './account-cards';
import { billingApi } from '../api';

/** Management view of the clinic accounts and the responsible cashier. */
export function RegistersOverviewPage() {
  const t = useTranslations('cashier');
  const tb = useTranslations('billing');
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['shifts', 'overview', activeBranchId],
    queryFn: async () => (await billingApi.registersOverview()).data,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <PageHeader title={t('overview.title')} description={t('overview.description')} />

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <p className="text-sm text-destructive">{t('shift.loadFailedTitle')}</p>
            <Button variant="outline" onClick={() => void refetch()}>
              {t('shift.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : !data || data.registers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t('overview.noneOpen')}
          </CardContent>
        </Card>
      ) : (
        <>
          {data.totals.unallocatedOpeningTransfer &&
          data.totals.unallocatedOpeningTransfer !== '0.00' ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" />
              <div>
                <p className="font-semibold">
                  {tb('accounts.legacyTitle', {
                    amount: formatUZS(data.totals.unallocatedOpeningTransfer),
                  })}
                </p>
                <p className="mt-1 text-muted-foreground">{tb('accounts.legacyHint')}</p>
              </div>
            </div>
          ) : null}
          <AccountCards accounts={data.totals.accounts} />

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('overview.cashier')}</TableHead>
                    <TableHead>{t('overview.openedAt')}</TableHead>
                    {(['CASH', 'CARD', 'CLICK'] as const).map((method) => (
                      <TableHead key={method} className="text-right">
                        {tb(`accounts.${method}`)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.registers.map((r) => (
                    <TableRow key={r.shiftId}>
                      <TableCell className="font-medium">{r.cashier.fullName}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTz(r.openedAt)}
                      </TableCell>
                      {r.accounts.map((account) => (
                        <TableCell
                          key={account.method}
                          className="text-right font-medium tabular-nums"
                        >
                          {formatUZS(account.expected, { withCurrency: false })}
                        </TableCell>
                      ))}
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
