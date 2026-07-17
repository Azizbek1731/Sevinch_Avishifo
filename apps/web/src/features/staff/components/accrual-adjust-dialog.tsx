'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { z } from 'zod';
import { formatUZS, signedMoneySchema } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { sanitizeMoney, staffApi, type PayrollAccrualRow } from '../api';
import { useApiErrorToast } from '../hooks';

const adjustSchema = z.object({
  adjustment: signedMoneySchema,
  note: z.string().max(1000).optional(),
});
type AdjustInput = z.infer<typeof adjustSchema>;

export interface AccrualAdjustDialogProps {
  /** null → closed. */
  accrual: PayrollAccrualRow | null;
  onOpenChange: (open: boolean) => void;
}

export function AccrualAdjustDialog({ accrual, onOpenChange }: AccrualAdjustDialogProps) {
  const t = useTranslations('staff');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const open = accrual !== null;

  const form = useForm<AdjustInput>({
    resolver: zodResolver(adjustSchema),
    defaultValues: { adjustment: '0', note: '' },
  });

  useEffect(() => {
    if (!accrual) return;
    form.reset({ adjustment: accrual.adjustment, note: accrual.note ?? '' });
  }, [accrual]);

  const mutation = useMutation({
    mutationFn: (values: AdjustInput) => {
      if (!accrual) throw new Error('No accrual selected');
      return staffApi.adjustAccrual(accrual.id, {
        adjustment: values.adjustment,
        note: values.note?.trim() ? values.note.trim() : undefined,
      });
    },
    onSuccess: () => {
      toast.success(t('payroll.adjustSaved'));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'accruals'] });
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('payroll.adjustTitle')}</DialogTitle>
        </DialogHeader>
        {accrual ? (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="rounded-md bg-muted/60 p-3 text-sm">
              <p className="font-medium">{accrual.doctorName}</p>
              <p className="text-muted-foreground">
                {accrual.period} · {t('payroll.base')}: {formatUZS(accrual.baseAmount)} ·{' '}
                {t('payroll.bonus')}: {formatUZS(accrual.bonusAmount)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accrual-adjustment">{t('payroll.adjustment')}</Label>
              <Input
                id="accrual-adjustment"
                inputMode="decimal"
                autoComplete="off"
                {...form.register('adjustment', { setValueAs: sanitizeMoney })}
              />
              {form.formState.errors.adjustment ? (
                <p className="text-sm text-destructive">{t('form.invalidAmount')}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('payroll.adjustHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accrual-note">{t('payroll.note')}</Label>
              <Textarea id="accrual-note" rows={3} {...form.register('note')} />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {t('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
