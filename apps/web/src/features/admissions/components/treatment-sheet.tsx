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
    mutationFn: (v: { orderId: string; date: string; status: 'GIVEN' | 'SKIPPED' }) =>
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
              {orders[0]?.days.map((d) => (
                <th key={d.date} className="px-1 py-2 text-center text-xs font-normal text-muted-foreground">
                  {d.date.slice(5)}
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
                    </span>
                  </td>
                  {o.days.map((d) => (
                    <td key={d.date} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={!canMark || !!o.stoppedAt || mark.isPending}
                        onClick={() => mark.mutate({ orderId: o.id, date: d.date, status: next(d.status) })}
                        aria-label={`${name} · ${d.date}`}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded border transition-colors',
                          d.status === 'GIVEN' && 'border-success/40 bg-success/15 text-success',
                          d.status === 'SKIPPED' && 'border-destructive/40 bg-destructive/10 text-destructive',
                          d.status === null && 'border-dashed text-muted-foreground',
                          canMark && !o.stoppedAt && 'hover:border-primary hover:text-primary',
                          (!canMark || o.stoppedAt) && 'cursor-default',
                        )}
                      >
                        {d.status === 'GIVEN' ? (
                          <Check className="h-4 w-4" />
                        ) : d.status === 'SKIPPED' ? (
                          <X className="h-4 w-4" />
                        ) : (
                          <Minus className="h-3 w-3" />
                        )}
                      </button>
                    </td>
                  ))}
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
