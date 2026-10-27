'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatUZS } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApiErrorToast } from '@/features/services/hooks';
import { usePermissions } from '@/hooks/use-permissions';
import { localizedText } from '@/lib/localized';
import { admissionsApi, type AdmissionOrder } from '../api';

/** The reception records an order once; billing does not await delivery marks. */
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
  const tb = useTranslations('billing');
  const tc = useTranslations('common');
  const locale = useLocale();
  const can = usePermissions();
  const qc = useQueryClient();
  const onError = useApiErrorToast();
  const [stopId, setStopId] = useState<string | null>(null);
  const stop = useMutation({
    mutationFn: (id: string) => admissionsApi.stopOrder(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admission', admissionId] });
      setStopId(null);
      toast.success(t('sheet.stopped'));
    },
    onError,
  });

  if (!orders.length)
    return <p className="py-6 text-center text-sm text-muted-foreground">{t('sheet.empty')}</p>;

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
        {t('directBilling.hint')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t('sheet.service')}</th>
              <th className="px-3 py-2 font-medium">{t('fields.schedule')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('directBilling.quantity')}</th>
              <th className="px-3 py-2 font-medium">{t('directBilling.billing')}</th>
              <th>
                <span className="sr-only">{t('sheet.stop')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const total = order.timesPlanned * order.timesPerDay;
              const recorded = order.days.flatMap((day) => day.slots);
              const given = recorded.filter((slot) => slot.status === 'GIVEN').length;
              const skipped = recorded.filter((slot) => slot.status === 'SKIPPED').length;
              const invoice = order.billing?.invoice;
              return (
                <tr key={order.id} className="border-b last:border-0">
                  <td className="max-w-xs px-3 py-3">
                    <p className="font-medium">{localizedText(order.service?.name, locale)}</p>
                    {order.stoppedAt ? (
                      <Badge variant="outline" className="mt-1">
                        {t('sheet.stopped')}
                      </Badge>
                    ) : null}
                    {order.note ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                        {order.note}
                      </p>
                    ) : null}
                    {given || skipped ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('directBilling.recorded', { given, skipped })}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <p>
                      {t(`sheet.schedules.${order.schedule}`)} ·{' '}
                      {t('sheet.perDayShort', { count: order.timesPerDay })}
                    </p>
                    <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                      {order.startDate.slice(0, 10)}
                      {order.days.length > 1 ? ` — ${order.days[order.days.length - 1]!.date}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{total}</td>
                  <td className="px-3 py-3">
                    {order.billing ? (
                      <p className="font-medium tabular-nums">
                        {formatUZS(order.billing.lineTotal)}
                      </p>
                    ) : null}
                    {invoice ? (
                      <div className="mt-1 space-y-1">
                        <Badge variant="outline">
                          {invoice.status === 'ISSUED'
                            ? t('directBilling.awaitingPayment')
                            : tb(`statuses.${invoice.status}`)}
                        </Badge>
                        {can('invoices.read') ? (
                          <Link
                            className="block text-xs text-primary underline"
                            href={`/invoices/${invoice.id}`}
                          >
                            {invoice.number}
                          </Link>
                        ) : null}
                      </div>
                    ) : order.billing?.status === 'PENDING' ? (
                      <Badge variant="outline">{t('directBilling.awaitingPayment')}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t(
                          order.billing?.status === 'CANCELLED'
                            ? 'directBilling.cancelled'
                            : 'directBilling.legacy',
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-2 text-right">
                    {!readOnly && !order.stoppedAt && can('admissions.write') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={stop.isPending}
                        onClick={() => setStopId(order.id)}
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
      <ConfirmDialog
        open={stopId !== null}
        onOpenChange={(open) => {
          if (!open) setStopId(null);
        }}
        title={t('sheet.stop')}
        description={t('directBilling.stopHint')}
        confirmLabel={t('sheet.stop')}
        cancelLabel={tc('cancel')}
        onConfirm={() => {
          if (stopId && !stop.isPending) stop.mutate(stopId);
        }}
      />
    </div>
  );
}
