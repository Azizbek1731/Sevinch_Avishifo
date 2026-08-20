'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { billingApi } from '../api';
import { useApiErrorToast, useInvalidateBilling } from '../hooks';

/**
 * Reverses a payment that should never have been recorded.
 *
 * Deliberately behind a confirmation with the amount and method spelled out:
 * this moves money on the books and changes what the cashier is answerable for
 * at the end of the shift, so it should not be one stray click away.
 */
export function VoidPaymentButton({
  payment,
}: {
  payment: { id: string; amount: string; method: string };
}) {
  const t = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const invalidate = useInvalidateBilling();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => billingApi.voidPayment(payment.id, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      setReason('');
      toast.success(t('void.done'));
    },
    onError: errorToast,
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t('void.action')}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('void.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('void.description', {
                amount: formatUZS(payment.amount),
                method: t(`methods.${payment.method}` as never),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="void-reason">{t('void.reason')}</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              placeholder={t('void.reasonPlaceholder')}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>{t('void.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mutation.isPending ? t('void.working') : t('void.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
