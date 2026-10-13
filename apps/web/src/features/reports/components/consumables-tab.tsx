'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ClipboardList, PackageOpen, Pill, RefreshCw } from 'lucide-react';
import { formatUZS, type ConsumablesKind, type ConsumablesSource } from '@avishifo/shared';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import type { ReportFilters } from '../api';
import { useConsumablesReport } from '../hooks';
import { ExportButton } from './export-button';

const KINDS: ConsumablesKind[] = ['MEDICINE', 'MATERIAL'];
const SOURCES: ConsumablesSource[] = ['SURGERY', 'INPATIENT', 'OUTPATIENT'];

/** Keep decimal quantities exact, including totals beyond Number's safe integer range. */
function quantityText(value: string): string {
  const [whole, decimals = ''] = value.split('.');
  const fraction = decimals.replace(/0+$/, '');
  return `${whole?.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? `.${fraction}` : ''}`;
}

export function ConsumablesTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports');
  const locale = useLocale();
  const [kind, setKind] = useState<ConsumablesKind | undefined>();
  const [source, setSource] = useState<ConsumablesSource | undefined>();
  const query = useConsumablesReport(filters, kind, source);
  const report = query.data;
  const hasOrdered = (report?.totals.orderedEntries ?? 0) > 0;
  const extra: Record<string, string> = {};
  if (kind) extra.kind = kind;
  if (source) extra.source = source;

  return (
    <div className="min-w-0 space-y-5" aria-busy={query.isFetching}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Select
            value={kind ?? 'ALL'}
            onValueChange={(value) => setKind(KINDS.find((item) => item === value))}
          >
            <SelectTrigger className="w-full sm:w-[190px]" aria-label={t('consumables.kindFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('consumables.allKinds')}</SelectItem>
              {KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`consumables.kinds.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={source ?? 'ALL'}
            onValueChange={(value) => setSource(SOURCES.find((item) => item === value))}
          >
            <SelectTrigger
              className="w-full sm:w-[200px]"
              aria-label={t('consumables.sourceFilter')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('consumables.allSources')}</SelectItem>
              {SOURCES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`consumables.sources.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            path="/reports/consumables"
            filenameBase="consumables"
            filters={filters}
            extra={extra}
            permission="reports.cash.export"
          />
        </div>
      </div>
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <p className="font-medium">
          {formatDate(filters.from)} – {formatDate(filters.to)} · {t('consumables.scope')}
        </p>
        <p className="mt-1 leading-relaxed text-muted-foreground">{t('consumables.explanation')}</p>
      </div>
      {query.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-6 text-sm text-destructive"
        >
          {t('consumables.error')}
        </div>
      ) : query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-32" />
          ))}
        </div>
      ) : report ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-primary/25 bg-primary/5">
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{t('consumables.actualAmount')}</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
                  {formatUZS(report.totals.amount)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{t('consumables.tariffHint')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  {t('consumables.itemCount')}
                  <PackageOpen className="h-4 w-4" />
                </div>
                <p className="mt-3 text-2xl font-semibold tabular-nums">
                  {report.totals.itemCount}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('consumables.itemCountHint')}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  {t('consumables.entries')}
                  <ClipboardList className="h-4 w-4" />
                </div>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{report.totals.entries}</p>
                <p className="mt-2 text-xs text-muted-foreground">{t('consumables.entriesHint')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{t('consumables.orderedAmount')}</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
                  {formatUZS(report.totals.orderedAmount)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('consumables.orderedCount', { count: report.totals.orderedEntries })}
                </p>
              </CardContent>
            </Card>
          </div>
          {report.items.length === 0 ? (
            <Card>
              <CardContent className="py-10">
                <EmptyState
                  icon={PackageOpen}
                  title={t('consumables.emptyTitle')}
                  description={t('empty.description')}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('consumables.items')}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">{t('consumables.columns.name')}</TableHead>
                        <TableHead>{t('consumables.columns.kind')}</TableHead>
                        <TableHead>{t('consumables.columns.unit')}</TableHead>
                        <TableHead className="text-right">
                          {t('consumables.columns.quantity')}
                        </TableHead>
                        <TableHead className={cn('text-right', !hasOrdered && 'pr-6')}>
                          {t('consumables.columns.amount')}
                        </TableHead>
                        {hasOrdered && (
                          <TableHead className="border-l bg-muted/30 text-right">
                            {t('consumables.columns.orderedQuantity')}
                          </TableHead>
                        )}
                        {hasOrdered && (
                          <TableHead className="bg-muted/30 pr-6 text-right">
                            {t('consumables.columns.orderedAmount')}
                          </TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.items.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="min-w-[190px] pl-6">
                            <p className="font-medium">{localizedText(row.title, locale, '—')}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {row.code ?? t('consumables.manual')}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="whitespace-nowrap font-normal">
                              {row.kind === 'MEDICINE' ? (
                                <Pill className="mr-1 h-3 w-3" />
                              ) : (
                                <PackageOpen className="mr-1 h-3 w-3" />
                              )}
                              {t(`consumables.kinds.${row.kind}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{row.unit}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {quantityText(row.quantity)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums whitespace-nowrap font-medium',
                              !hasOrdered && 'pr-6',
                            )}
                          >
                            {formatUZS(row.amount, { withCurrency: false })}
                          </TableCell>
                          {hasOrdered && (
                            <TableCell className="border-l bg-muted/20 text-right tabular-nums whitespace-nowrap">
                              {quantityText(row.orderedQuantity)}
                            </TableCell>
                          )}
                          {hasOrdered && (
                            <TableCell className="bg-muted/20 pr-6 text-right tabular-nums whitespace-nowrap">
                              {formatUZS(row.orderedAmount, { withCurrency: false })}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell colSpan={3} className="pl-6">
                          {t('cashflow.total')}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums whitespace-nowrap',
                            !hasOrdered && 'pr-6',
                          )}
                        >
                          {formatUZS(report.totals.amount, { withCurrency: false })}
                        </TableCell>
                        {hasOrdered && (
                          <TableCell className="border-l text-right text-muted-foreground">
                            —
                          </TableCell>
                        )}
                        {hasOrdered && (
                          <TableCell className="pr-6 text-right tabular-nums whitespace-nowrap">
                            {formatUZS(report.totals.orderedAmount, { withCurrency: false })}
                          </TableCell>
                        )}
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="grid min-w-0 gap-5 xl:grid-cols-[2fr_1fr]">
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="text-base">{t('consumables.periods')}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">{t('cashflow.period')}</TableHead>
                          <TableHead className="text-right">{t('consumables.entries')}</TableHead>
                          <TableHead className={cn('text-right', !hasOrdered && 'pr-6')}>
                            {t('consumables.actualAmount')}
                          </TableHead>
                          {hasOrdered && (
                            <TableHead className="border-l pr-6 text-right">
                              {t('consumables.orderedAmount')}
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.periods.map((row) => (
                          <TableRow key={row.bucket}>
                            <TableCell className="pl-6 whitespace-nowrap">
                              {formatDate(row.bucket)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums whitespace-nowrap',
                                !hasOrdered && 'pr-6',
                              )}
                            >
                              {formatUZS(row.amount, { withCurrency: false })}
                            </TableCell>
                            {hasOrdered && (
                              <TableCell className="border-l pr-6 text-right tabular-nums whitespace-nowrap">
                                {formatUZS(row.orderedAmount, { withCurrency: false })}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="text-base">{t('consumables.units')}</CardTitle>
                    <p className="text-xs text-muted-foreground">{t('consumables.unitsHint')}</p>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">{t('consumables.columns.unit')}</TableHead>
                          <TableHead className={cn('text-right', !hasOrdered && 'pr-6')}>
                            {t('consumables.columns.quantity')}
                          </TableHead>
                          {hasOrdered && (
                            <TableHead className="border-l pr-6 text-right">
                              {t('consumables.columns.orderedQuantity')}
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.units.map((row) => (
                          <TableRow key={row.unit}>
                            <TableCell className="pl-6">{row.unit}</TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums whitespace-nowrap',
                                !hasOrdered && 'pr-6',
                              )}
                            >
                              {quantityText(row.quantity)}
                            </TableCell>
                            {hasOrdered && (
                              <TableCell className="border-l pr-6 text-right tabular-nums whitespace-nowrap">
                                {quantityText(row.orderedQuantity)}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          <div className="space-y-2 rounded-lg border bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <p>{t('consumables.orderedPolicy')}</p>
            <p>{t('consumables.datePolicy')}</p>
            <p>{t('consumables.catalogHint')}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
