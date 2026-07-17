'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { addPaymentSchema, formatUZS, PaymentMethod, type MoneyString } from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
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
import { billingApi, sanitizeMoney } from '../api';
import { useApiErrorToast, useInvalidateBilling } from '../hooks';

const payFormSchema = addPaymentSchema.omit({ idempotencyKey: true });
type PayFormValues = { amount: MoneyString; method: PaymentMethod };

export interface PayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: { id: string; number: string; due: MoneyString };
}

export function PayDialog({ open, onOpenChange, invoice }: PayDialogProps) {
  const t = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const invalidate = useInvalidateBilling();
  const router = useRouter();

  // One idempotency key per dialog opening: retries of the same submission reuse it.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  const form = useForm<PayFormValues>({
    resolver: zodResolver(payFormSchema),
    defaultValues: { amount: invoice.due, method: PaymentMethod.CASH },
  });

  useEffect(() => {
    if (open) {
      setIdempotencyKey(crypto.randomUUID());
      form.reset({ amount: invoice.due, method: PaymentMethod.CASH });
    }
  }, [open, invoice.id, invoice.due]);

  const mutation = useMutation({
    mutationFn: (values: PayFormValues) =>
      billingApi.addPayment(invoice.id, { ...values, idempotencyKey }),
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast.success(t('pay.success'), {
        action: {
          label: t('pay.viewReceipt'),
          onClick: () => router.push(`/invoices/${invoice.id}/receipt`),
        },
      });
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  const method = form.watch('method');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pay.title', { number: invoice.number })}</DialogTitle>
          <DialogDescription>
            {t('pay.due')}: <span className="font-semibold">{formatUZS(invoice.due)}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="pay-amount">{t('pay.amount')}</Label>
            <Input
              id="pay-amount"
              inputMode="decimal"
              autoComplete="off"
              className="text-lg font-semibold"
              {...form.register('amount', { setValueAs: sanitizeMoney })}
            />
            {form.formState.errors.amount ? (
              <p className="text-sm text-destructive">{t('form.invalidAmount')}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>{t('pay.method')}</Label>
            <Select
              value={method}
              onValueChange={(v) => form.setValue('method', v as PaymentMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PaymentMethod).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`methods.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? t('pay.paying') : t('pay.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
