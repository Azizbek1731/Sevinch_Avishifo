'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Smartphone,
  RefreshCw,
} from 'lucide-react';
import { formatUZS, type CashflowTotals } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import type { ReportFilters } from '../api';
import { useCashflowReport } from '../hooks';
import { ExportButton } from './export-button';

const METHODS = ['CASH', 'CARD', 'CLICK'] as const;
const ICONS = { CASH: Banknote, CARD: CreditCard, CLICK: Smartphone };
const COLUMNS = ['receipts', 'deposits', 'refunds', 'expenses', 'net'] as const;
type Method = (typeof METHODS)[number];

export function CashflowTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const [method, setMethod] = useState<Method | undefined>();
  const query = useCashflowReport(filters, method);
  const report = query.data;
  const moneyCells = (row: CashflowTotals) =>
    COLUMNS.map((key) => (
      <TableCell
        key={key}
        className={cn(
          'text-right tabular-nums whitespace-nowrap',
          key === 'net' && 'font-semibold',
          key === 'net' && row.net.startsWith('-') && 'text-destructive',
        )}
      >
        {formatUZS(row[key], { withCurrency: false })}
      </TableCell>
    ));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          <Button
            size="sm"
            variant={method === undefined ? 'default' : 'ghost'}
            onClick={() => setMethod(undefined)}
          >
            {t('cashflow.allMethods')}
          </Button>
          {METHODS.map((value) => {
            const Icon = ICONS[value];
            return (
              <Button
                key={value}
                size="sm"
                variant={method === value ? 'default' : 'ghost'}
                onClick={() => setMethod(value)}
              >
                <Icon className="h-4 w-4" />
                {t(`methods.${value}`)}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
            {t('cashflow.refresh')}
          </Button>
          <ExportButton
            path="/reports/cashflow"
            filenameBase="cashflow"
            filters={filters}
            extra={method ? { method } : undefined}
            permission="reports.cash.export"
          />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <p className="font-medium">
          {formatDate(filters.from)} – {formatDate(filters.to)} · {t('cashflow.scope')}
        </p>
        <p className="mt-1 text-muted-foreground">{t('cashflow.explanation')}</p>
      </div>
      {query.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-6 text-sm text-destructive"
        >
          {t('cashflow.error')}
        </div>
      ) : query.isPending ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-32" />
          ))}
        </div>
      ) : (
        report && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {(['inflow', 'outflow', 'net'] as const).map((key) => (
                <Card key={key} className={cn(key === 'net' && 'border-primary/25 bg-primary/5')}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      {t(`cashflow.${key}`)}
                      {key === 'inflow' ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : key === 'outflow' ? (
                        <ArrowUpRight className="h-4 w-4" />
                      ) : (
                        <Banknote className="h-4 w-4" />
                      )}
                    </div>
                    <p
                      className={cn(
                        'mt-3 text-2xl font-semibold tracking-tight tabular-nums',
                        key === 'net' && report.totals.net.startsWith('-') && 'text-destructive',
                      )}
                    >
                      {formatUZS(report.totals[key])}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {key === 'inflow'
                        ? t('cashflow.inflowDetail', {
                            receipts: formatUZS(report.totals.receipts),
                            deposits: formatUZS(report.totals.deposits),
                          })
                        : key === 'outflow'
                          ? t('cashflow.outflowDetail', {
                              refunds: formatUZS(report.totals.refunds),
                              expenses: formatUZS(report.totals.expenses),
                            })
                          : t('cashflow.netDetail', { count: report.totals.operations })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t('cashflow.accounts')}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {t('cashflow.currency')}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">{t('cashflow.method')}</TableHead>
                      {COLUMNS.map((key) => (
                        <TableHead key={key} className="text-right">
                          {t(`cashflow.${key}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.accounts.map((row) => (
                      <TableRow key={row.method}>
                        <TableCell className="pl-6 font-medium">
                          {METHODS.some((value) => value === row.method)
                            ? t(`methods.${row.method}`)
                            : t('cashflow.legacyMethod', {
                                method: t.has(`methods.${row.method}`)
                                  ? t(`methods.${row.method}`)
                                  : row.method,
                              })}
                        </TableCell>
                        {moneyCells(row)}
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell className="pl-6">{t('cashflow.total')}</TableCell>
                      {moneyCells(report.totals)}
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('cashflow.periods')}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">{t('cashflow.period')}</TableHead>
                        {COLUMNS.map((key) => (
                          <TableHead key={key} className="text-right">
                            {t(`cashflow.${key}`)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.periods.length ? (
                        report.periods.map((row) => (
                          <TableRow key={row.bucket}>
                            <TableCell className="pl-6 whitespace-nowrap">
                              {formatDate(row.bucket)}
                            </TableCell>
                            {moneyCells(row)}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                            {t('empty.description')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('cashflow.categories')}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">{t('cashflow.category')}</TableHead>
                        <TableHead className="pr-6 text-right">{t('cashflow.expenses')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.expenseCategories.length ? (
                        report.expenseCategories.map((row) => (
                          <TableRow key={row.category}>
                            <TableCell className="pl-6">{row.category}</TableCell>
                            <TableCell className="pr-6 text-right tabular-nums whitespace-nowrap">
                              {formatUZS(row.amount, { withCurrency: false })}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                            {t('empty.description')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('cashflow.datePolicy')}
            </p>
          </>
        )
      )}
    </div>
  );
}
