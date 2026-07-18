'use client';

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Calculator, ChevronDown, ChevronRight, Download, Pencil, Wallet } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useEnumLabel } from '@/hooks/use-enum-label';
import { todayTashkent } from '@/lib/dates';
import { parseBreakdown, staffApi, type PayrollAccrualRow } from '../api';
import { useApiErrorToast, usePayrollAccruals, usePermissions } from '../hooks';
import { AccrualAdjustDialog } from './accrual-adjust-dialog';

export function PayrollTab() {
  const t = useTranslations('staff');
  const enumLabel = useEnumLabel();
  const can = usePermissions();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = can('payroll.write');

  const [period, setPeriod] = useState(() => todayTashkent().slice(0, 7));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adjusting, setAdjusting] = useState<PayrollAccrualRow | null>(null);

  const query = usePayrollAccruals(period);
  const items = useMemo(() => query.data?.data ?? [], [query.data]);

  const generateMutation = useMutation({
    mutationFn: () => staffApi.generateAccruals(period),
    onSuccess: (res) => {
      toast.success(t('payroll.generated', { count: res.data.doctorsProcessed }));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'accruals'] });
    },
    onError: errorToast,
  });

  const exportMutation = useMutation({
    mutationFn: () => staffApi.exportAccrualsXlsx(period),
    onSuccess: (res) => {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${period}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: errorToast,
  });

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="payroll-period">{t('payroll.period')}</Label>
          <Input
            id="payroll-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-44"
          />
        </div>
        {canWrite ? (
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            <Calculator className="mr-1 h-4 w-4" />
            {t('payroll.generate')}
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending || items.length === 0}
        >
          <Download className="mr-1 h-4 w-4" />
          {t('payroll.export')}
        </Button>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t('payroll.empty.title')}
          description={t('payroll.empty.description')}
        />
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t('payroll.doctor')}</TableHead>
                <TableHead className="text-right">{t('payroll.base')}</TableHead>
                <TableHead className="text-right">{t('payroll.bonus')}</TableHead>
                <TableHead className="text-right">{t('payroll.adjustment')}</TableHead>
                <TableHead className="text-right">{t('payroll.total')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => {
                const isOpen = Boolean(expanded[row.id]);
                const breakdown = parseBreakdown(row.breakdown);
                const negativeAdj = row.adjustment.startsWith('-');
                return (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(row.id)}>
                      <TableCell>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{row.doctorName}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatUZS(row.baseAmount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {formatUZS(row.bonusAmount)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'whitespace-nowrap text-right',
                          negativeAdj && 'text-destructive',
                        )}
                      >
                        {formatUZS(row.adjustment)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">
                        {formatUZS(row.total)}
                      </TableCell>
                      <TableCell>
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={t('payroll.adjust')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAdjusting(row);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={7} className="py-3">
                          {breakdown.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              {t('payroll.noBreakdown')}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {breakdown.map((line, i) => (
                                <div
                                  key={i}
                                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                >
                                  <span>
                                    <span className="font-medium">
                                      {enumLabel('compensation', line.ruleType)}
                                    </span>
                                    <span className="text-muted-foreground"> · {line.basis}</span>
                                  </span>
                                  <span className="whitespace-nowrap font-medium">
                                    {formatUZS(line.amount)}
                                  </span>
                                </div>
                              ))}
                              {row.note ? (
                                <p className="pt-1 text-sm text-muted-foreground">
                                  {t('payroll.note')}: {row.note}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AccrualAdjustDialog
        accrual={adjusting}
        onOpenChange={(open) => {
          if (!open) setAdjusting(null);
        }}
      />
    </div>
  );
}
