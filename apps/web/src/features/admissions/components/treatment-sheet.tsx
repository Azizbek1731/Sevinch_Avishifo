'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useApiErrorToast } from '@/features/services/hooks';
import { usePermissions } from '@/hooks/use-permissions';
import { admissionsApi, type AdmissionOrder } from '../api';

/**
 * Muolajalar varag'i — the treatment sheet as the ward keeps it.
 *
 * One row per ordered service, one cell per planned day. The ward reports what
 * was actually done and whoever is at the desk marks it: given, or refused.
 * Refused is a mark of its own rather than an empty cell, because "the patient
 * would not take it" and "nobody has got to it yet" are different facts and
 * only one of them means the day is finished.
 */
export function TreatmentSheet({
  admissionId,
  orders,
  readOnly,
}: {
  admissionId: string;
  orders: AdmissionOrder[];
  readOnly?: boolean;
}) {
  const t = useTranslations('admissions');
  const locale = useLocale();
  const can = usePermissions();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const canMark = !readOnly && can('admissions.administer');

  const mark = useMutation({
    mutationFn: (v: { orderId: string; date: string; slot: number; status: 'GIVEN' | 'SKIPPED' }) =>
      admissionsApi.mark(admissionId, v),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      // Marking a day given writes money to the patient's account.
      void queryClient.invalidateQueries({ queryKey: ['charges'] });
    },
    onError: errorToast,
  });

  const stop = useMutation({
    mutationFn: (orderId: string) => admissionsApi.stopOrder(orderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admission', admissionId] });
      toast.success(t('sheet.stopped'));
    },
    onError: errorToast,
  });

  if (orders.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('sheet.empty')}</p>;
  }

  /** Cycles blank → given → refused → blank, so one control does all three. */
  const next = (current: 'GIVEN' | 'SKIPPED' | null): 'GIVEN' | 'SKIPPED' =>
    current === 'GIVEN' ? 'SKIPPED' : 'GIVEN';

  // The header is the UNION of every order's planned dates: orders start on
  // different days, and columns taken from the first row alone would put the
  // other rows' marks under the wrong dates.
  const columnDates = [...new Set(orders.flatMap((o) => o.days.map((d) => d.date)))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-success/40 bg-success/15 text-success">
            <Check className="h-3 w-3" />
          </span>
          {t('sheet.given')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-destructive/40 bg-destructive/10 text-destructive">
            <X className="h-3 w-3" />
          </span>
          {t('sheet.skipped')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded border border-dashed text-muted-foreground">
            <Minus className="h-3 w-3" />
          </span>
          {t('sheet.pending')}
        </span>
      </div>

      {/* Scrolls inside itself — a long stay is wider than a phone. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium">
                {t('sheet.service')}
              </th>
              {columnDates.map((date) => (
                <th key={date} className="px-1 py-2 text-center text-xs font-normal text-muted-foreground">
                  {date.slice(5)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const name =
                (o.service?.name as Record<string, string> | undefined)?.[locale] ??
                o.service?.name?.uz ??
                '—';
              return (
                <tr key={o.id} className={o.stoppedAt ? 'opacity-50' : undefined}>
                  <td className="sticky left-0 z-10 max-w-[16rem] truncate bg-background px-3 py-2">
                    <span className="font-medium">{name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t(`sheet.schedules.${o.schedule}`)}
                      {o.timesPerDay > 1
                        ? ` · ${t('sheet.perDayShort', { count: o.timesPerDay })}`
                        : ''}
                    </span>
                  </td>
                  {columnDates.map((date) => {
                    const day = o.days.find((d) => d.date === date);
                    if (!day) {
                      // This order simply has no dose planned on this date.
                      return <td key={date} className="px-1 py-1" />;
                    }
                    const compact = day.slots.length > 1;
                    return (
                      <td key={date} className="px-1 py-1 text-center">
                        <div className={cn('flex items-center justify-center', compact ? 'gap-0.5' : '')}>
                          {day.slots.map((sl) => (
                            <button
                              key={sl.slot}
                              type="button"
                              disabled={!canMark || !!o.stoppedAt || mark.isPending}
                              onClick={() =>
                                mark.mutate({
                                  orderId: o.id,
                                  date,
                                  slot: sl.slot,
                                  status: next(sl.status),
                                })
                              }
                              aria-label={`${name} · ${date} · ${sl.slot}`}
                              title={compact ? t('sheet.doseTitle', { n: sl.slot }) : undefined}
                              className={cn(
                                'flex items-center justify-center rounded border transition-colors',
                                compact ? 'h-8 w-6' : 'h-8 w-8',
                                sl.status === 'GIVEN' && 'border-success/40 bg-success/15 text-success',
                                sl.status === 'SKIPPED' &&
                                  'border-destructive/40 bg-destructive/10 text-destructive',
                                sl.status === null && 'border-dashed text-muted-foreground',
                                canMark && !o.stoppedAt && 'hover:border-primary hover:text-primary',
                                (!canMark || o.stoppedAt) && 'cursor-default',
                              )}
                            >
                              {sl.status === 'GIVEN' ? (
                                <Check className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                              ) : sl.status === 'SKIPPED' ? (
                                <X className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                              ) : (
                                <Minus className="h-3 w-3" />
                              )}
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2">
                    {canMark && !o.stoppedAt && can('admissions.write') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground"
                        onClick={() => stop.mutate(o.id)}
                      >
                        {t('sheet.stop')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
