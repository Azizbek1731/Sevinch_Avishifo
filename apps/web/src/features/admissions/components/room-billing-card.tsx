'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { roomRateSchema } from '@avishifo/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiErrorToast } from '@/features/services/hooks';
import { admissionsApi, type AdmissionDetail } from '../api';

export function RoomBillingCard({ admission, canEdit }: { admission: AdmissionDetail; canEdit: boolean }) {
  const t = useTranslations('admissions.roomBilling');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? admission.dailyRoomRate ?? '';
  const money = (amount: string) => `${Number(amount).toLocaleString('uz-UZ')} ${t('currency')}`;
  const save = useMutation({
    mutationFn: (rate: string) => admissionsApi.update(admission.id, { dailyRoomRate: rate }),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['admission', admission.id] });
      void queryClient.invalidateQueries({ queryKey: ['charges'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['patient-checkout'] });
      toast.success(t('saved'));
    },
    onError: errorToast,
  });
  const billing = admission.roomBilling;
  return <Card>
    <CardHeader className="pb-3"><CardTitle className="text-base">{t('title')}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form className="space-y-1.5" onSubmit={(event) => {
          event.preventDefault();
          const parsed = roomRateSchema.safeParse(value.trim().replace(',', '.'));
          setInvalid(!parsed.success);
          if (parsed.success) save.mutate(parsed.data);
        }}>
          <Label htmlFor="room-daily-rate">{t('dailyRate')}</Label>
          <div className="flex items-center gap-2">
            <Input id="room-daily-rate" className="w-44" value={value} inputMode="decimal" placeholder="100000" readOnly={!canEdit} disabled={save.isPending} aria-invalid={invalid} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} />
            {canEdit ? <Button type="submit" variant="outline" disabled={save.isPending || draft === null}>{t('save')}</Button> : null}
          </div>
          {invalid ? <p className="text-xs text-destructive">{t('invalidRate')}</p> : null}
        </form>
        <div className="text-right"><p className="text-sm text-muted-foreground">{t('total', { days: billing?.days ?? 0 })}</p><p className="text-xl font-semibold">{money(billing?.total ?? '0')}</p></div>
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{t('rule')}</p>
        {canEdit ? <p>{admission.dailyRoomRate === null ? t('enableHint') : t('editHint', { date: admission.roomBillingNextDate ?? '—' })}</p> : null}
      </div>
      {billing?.items.length ? <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">{t('breakdown')}</summary>
        <div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">{t('date')}</th><th>{t('place')}</th><th className="text-right">{t('amount')}</th></tr></thead>
          <tbody>{billing.items.map((item) => <tr key={item.date} className="border-b last:border-0"><td className="py-2">{item.date}</td><td>{[item.ward, item.bed].filter(Boolean).join(' / ') || '—'}{item.status === 'CANCELLED' ? ` · ${t('cancelled')}` : ''}</td><td className="text-right tabular-nums">{money(item.rate)}</td></tr>)}</tbody>
        </table></div>
      </details> : null}
    </CardContent>
  </Card>;
}
