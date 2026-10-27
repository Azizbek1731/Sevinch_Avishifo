'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { roomRateSchema } from '@avishifo/shared';
import { toast } from 'sonner';
import { Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi, type AdmissionDetail } from '../api';

export function RoomBillingCard({
  admission,
  canEdit,
}: {
  admission: AdmissionDetail;
  canEdit: boolean;
}) {
  const t = useTranslations('admissions.roomBilling');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [daysToAdd, setDaysToAdd] = useState('1');
  const value = draft ?? admission.dailyRoomRate ?? '';
  const money = (amount: string) => `${Number(amount).toLocaleString('uz-UZ')} ${t('currency')}`;
  const billing = admission.roomBilling;
  const daysCount = Math.min(31, Math.max(1, Number.parseInt(daysToAdd, 10) || 1));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admission', admission.id] });
    void queryClient.invalidateQueries({ queryKey: ['charges'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['patient-checkout'] });
  };

  const save = useMutation({
    mutationFn: (rate: string) => admissionsApi.update(admission.id, { dailyRoomRate: rate }),
    onSuccess: () => {
      setDraft(null);
      invalidate();
      toast.success(t('saved'));
    },
    onError: errorToast,
  });

  const addDays = useMutation({
    mutationFn: (days: number) => admissionsApi.addRoomCharge(admission.id, days),
    onSuccess: (_data, days) => {
      invalidate();
      setDaysToAdd('1');
      toast.success(days === 1 ? t('added') : t('addedMany', { count: days }));
    },
    onError: errorToast,
  });

  const reverseDay = useMutation({
    mutationFn: (date: string) => admissionsApi.reverseRoomCharge(admission.id, date),
    onSuccess: () => {
      invalidate();
      toast.success(t('reversed'));
    },
    onError: errorToast,
  });

  const busy = save.isPending || addDays.isPending || reverseDay.isPending;
  const canAdd =
    canEdit &&
    admission.status === 'ACTIVE' &&
    admission.dailyRoomRate !== null &&
    (billing?.canAddManual ?? true);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = roomRateSchema.safeParse(value.trim().replace(',', '.'));
              setInvalid(!parsed.success);
              if (parsed.success) save.mutate(parsed.data);
            }}
          >
            <Label htmlFor="room-daily-rate">{t('periodRate')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="room-daily-rate"
                className="w-44"
                value={value}
                inputMode="decimal"
                placeholder="100000"
                readOnly={!canEdit}
                disabled={busy}
                aria-invalid={invalid}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setInvalid(false);
                }}
              />
              {canEdit ? (
                <Button type="submit" variant="outline" disabled={busy || draft === null}>
                  {t('save')}
                </Button>
              ) : null}
            </div>
            {invalid ? <p className="text-xs text-destructive">{t('invalidRate')}</p> : null}
          </form>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">{t('total', { days: billing?.days ?? 0 })}</p>
            <p className="text-xl font-semibold">{money(billing?.total ?? '0')}</p>
          </div>
        </div>

        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{t('rule')}</p>
          {canEdit && admission.dailyRoomRate === null ? <p>{t('enableHint')}</p> : null}
          {canEdit && admission.dailyRoomRate !== null && billing?.nextPeriodDate ? (
            <p>{t('nextHint', { date: billing.nextPeriodDate })}</p>
          ) : null}
          {canEdit ? <p>{t('reverseHint')}</p> : null}
        </div>

        {canAdd ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="room-days-count">{t('daysCount')}</Label>
              <Input
                id="room-days-count"
                className="w-24"
                inputMode="numeric"
                min={1}
                max={31}
                value={daysToAdd}
                disabled={busy}
                onChange={(event) => {
                  const raw = event.target.value.replace(/\D/g, '').slice(0, 2);
                  setDaysToAdd(raw);
                }}
                onBlur={() => setDaysToAdd(String(daysCount))}
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                if (addDays.isPending) return;
                addDays.mutate(daysCount);
              }}
              disabled={busy}
            >
              <Plus className="mr-2 h-4 w-4" />
              {daysCount === 1 ? t('addDay') : t('addDays', { count: daysCount })}
            </Button>
          </div>
        ) : null}

        {billing?.items.length ? (
          <details className="rounded-md border px-3 py-2" open>
            <summary className="cursor-pointer text-sm font-medium">{t('breakdown')}</summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">{t('date')}</th>
                    <th>{t('place')}</th>
                    <th className="text-right">{t('amount')}</th>
                    {canEdit ? <th className="w-28 text-right">{t('actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {billing.items.map((item) => (
                    <tr key={item.date} className="border-b last:border-0">
                      <td className="py-2">{item.date}</td>
                      <td>
                        {[item.ward, item.bed].filter(Boolean).join(' / ') || '—'}
                        {item.status === 'CANCELLED' ? ` · ${t('cancelled')}` : ''}
                        {item.paid ? ` · ${t('paid')}` : ''}
                      </td>
                      <td className="text-right tabular-nums">{money(item.rate)}</td>
                      {canEdit ? (
                        <td className="text-right">
                          {item.canReverse ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => {
                                if (reverseDay.isPending) return;
                                if (!window.confirm(t('reverseConfirm', { date: item.date }))) return;
                                reverseDay.mutate(item.date);
                              }}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              {t('reverse')}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
