'use client';

import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  createRefundSchema,
  formatUZS,
  PaymentMethod,
  type CreateRefundInput,
  type MoneyString,
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { EXTERNAL_PAYMENT_METHODS, inputTiyin } from '../payment-methods';
import { billingApi, sanitizeMoney } from '../api';
import { useApiErrorToast, useInvalidateBilling } from '../hooks';

export interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: { id: string; number: string; paidTotal: MoneyString };
}

export function RefundDialog({ open, onOpenChange, invoice }: RefundDialogProps) {
  const t = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const invalidate = useInvalidateBilling();
  const activeBranchId = useAuthStore((state) => state.activeBranchId);
  const shiftQuery = useQuery({
    queryKey: ['shifts', 'current', activeBranchId],
    queryFn: async () => (await billingApi.currentShift()).data,
    enabled: open,
  });

  const form = useForm<CreateRefundInput>({
    resolver: zodResolver(createRefundSchema),
    defaultValues: { amount: invoice.paidTotal, method: PaymentMethod.CASH, reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ amount: invoice.paidTotal, method: PaymentMethod.CASH, reason: '' });
  }, [open, invoice.id, invoice.paidTotal]);

  const mutation = useMutation({
    mutationFn: (values: CreateRefundInput) => billingApi.addRefund(invoice.id, values),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast.success(t('refundDlg.success'));
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!amountInvalid && shiftQuery.data?.open && !mutation.isPending) mutation.mutate(values);
  });
  const method = form.watch('method');
  const amountTiyin = inputTiyin(form.watch('amount'));
  const amountInvalid =
    amountTiyin === null ||
    amountTiyin <= 0n ||
    amountTiyin > (inputTiyin(invoice.paidTotal) ?? 0n);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('refundDlg.title', { number: invoice.number })}</DialogTitle>
          <DialogDescription>
            {t('refundDlg.paid')}:{' '}
            <span className="font-semibold">{formatUZS(invoice.paidTotal)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="refund-amount">{t('refundDlg.amount')}</Label>
            <Input
              id="refund-amount"
              inputMode="decimal"
              autoComplete="off"
              {...form.register('amount', { setValueAs: sanitizeMoney })}
            />
            {form.formState.errors.amount ? (
              <p className="text-sm text-destructive">{t('form.invalidAmount')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>{t('refundDlg.method')}</Label>
            <Select
              value={method}
              onValueChange={(v) => form.setValue('method', v as PaymentMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXTERNAL_PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`methods.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-reason">{t('refundDlg.reason')}</Label>
            <Textarea id="refund-reason" rows={2} {...form.register('reason')} />
            {form.formState.errors.reason ? (
              <p className="text-sm text-destructive">{t('refundDlg.reasonRequired')}</p>
            ) : null}
          </div>
          {!shiftQuery.data?.open ? (
            <p className="text-sm text-warning-foreground">{t('accounts.closedHint')}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={mutation.isPending || amountInvalid || !shiftQuery.data?.open}
            >
              {t('refundDlg.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
