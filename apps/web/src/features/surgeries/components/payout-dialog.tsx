'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  createSurgeryPayoutSchema,
  formatUZS,
  type CreateSurgeryPayoutInput,
} from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { billingApi } from '@/features/billing/api';
import { useApiErrorToast } from '@/features/services/hooks';
import { surgeriesApi, type Surgery } from '../api';
import { useInvalidateSurgeries } from '../hooks';
import { payoutPreview } from '../money';
import { identifySurgeryRequest, type SurgeryRequestKey } from '../request-key';

export function SurgeryPayoutDialog({
  surgery,
  open,
  onOpenChange,
}: {
  surgery: Surgery;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('surgeries');
  const branchId = useAuthStore((s) => s.activeBranchId);
  const identity = useRef<SurgeryRequestKey | null>(null);
  const invalidate = useInvalidateSurgeries();
  const onError = useApiErrorToast();
  const shift = useQuery({
    queryKey: ['shifts', 'current', branchId],
    queryFn: async () => (await billingApi.currentShift()).data,
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  const form = useForm<CreateSurgeryPayoutInput>({
    resolver: zodResolver(createSurgeryPayoutSchema),
  });
  useEffect(() => {
    if (open) {
      identity.current = null;
      form.reset({
        type: 'PERCENT',
        value: '',
        method: 'CASH',
        note: '',
        idempotencyKey: crypto.randomUUID(),
      });
    }
  }, [open, surgery.id, form]);
  const save = useMutation({
    mutationFn: (body: CreateSurgeryPayoutInput) => surgeriesApi.payout(surgery.id, body),
    onError,
    onSuccess: () => {
      invalidate();
      toast.success(t('payoutSaved'));
      identity.current = null;
      onOpenChange(false);
    },
  });
  const type = form.watch('type') ?? 'PERCENT';
  const preview = payoutPreview(surgery.feeAmount, type, form.watch('value') ?? '');
  const submit = form.handleSubmit((values) => {
    if (!shift.data || preview === null || preview === '0.00') return;
    const payload = {
      ...values,
      note: values.note?.trim() || undefined,
      idempotencyKey: undefined,
    };
    identity.current = identifySurgeryRequest(payload, identity.current);
    save.mutate({ ...values, note: payload.note, idempotencyKey: identity.current.key });
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!save.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('paySurgeon')}</DialogTitle>
          <DialogDescription>{t('payoutHint')}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="font-semibold">{surgery.surgeon.fullName}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('fee')}: {formatUZS(surgery.feeAmount)}
          </p>
        </div>
        {!shift.isLoading && !shift.data ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            {shift.isError ? t('loadError') : t('openShiftRequired')}{' '}
            <Link href="/cashier" className="font-semibold underline">
              {t('openCashier')}
            </Link>
          </div>
        ) : null}
        <form className="space-y-4" onSubmit={submit}>
          <fieldset className="space-y-4" disabled={save.isPending || !shift.data}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('payoutType')}</Label>
                <Select
                  value={type}
                  onValueChange={(value) =>
                    form.setValue('type', value as CreateSurgeryPayoutInput['type'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">{t('percent')}</SelectItem>
                    <SelectItem value="FIXED">{t('fixed')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="payout-value">
                  {t(type === 'PERCENT' ? 'percentValue' : 'amount')}
                </Label>
                <Input
                  id="payout-value"
                  inputMode="decimal"
                  {...form.register('value', {
                    setValueAs: (value: string) => value.replace(',', '.'),
                  })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('method')}</Label>
              <Select
                value={form.watch('method') ?? 'CASH'}
                onValueChange={(value) =>
                  form.setValue('method', value as CreateSurgeryPayoutInput['method'])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['CASH', 'CARD', 'CLICK'] as const).map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`methods.${method}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payout-note">{t('note')}</Label>
              <Textarea id="payout-note" maxLength={500} rows={2} {...form.register('note')} />
            </div>
          </fieldset>
          <div className="flex items-center justify-between rounded-lg bg-primary/5 p-4">
            <span>{t('payable')}</span>
            <strong className="text-xl">{preview !== null ? formatUZS(preview) : '—'}</strong>
          </div>
          {Object.keys(form.formState.errors).length ? (
            <p role="alert" className="text-sm text-destructive">
              {t('payoutInvalid')}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              disabled={save.isPending || !shift.data || preview === null || preview === '0.00'}
            >
              {t('confirmPayout')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
