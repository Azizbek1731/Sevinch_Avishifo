'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PiggyBank } from 'lucide-react';
import { addDepositSchema, formatUZS, type AddDepositInput } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { billingApi, sanitizeMoney, type PatientBrief } from '../api';
import { useApiErrorToast, usePermission } from '../hooks';
import { PatientCombobox } from './patient-combobox';

export function DepositTab() {
  const t = useTranslations('cashier');
  const tb = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const can = usePermission();
  const queryClient = useQueryClient();

  const [patient, setPatient] = useState<PatientBrief | null>(null);

  const form = useForm<AddDepositInput>({
    resolver: zodResolver(addDepositSchema),
    defaultValues: { patientId: '', amount: '', note: '' },
  });

  const { data: balance } = useQuery({
    queryKey: ['balance', patient?.id],
    queryFn: async () => (await billingApi.getBalance(patient?.id ?? '')).data,
    enabled: patient !== null,
  });

  const mutation = useMutation({
    mutationFn: (values: AddDepositInput) => billingApi.addDeposit(values.patientId, values),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['balance'] });
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success(t('deposit.success', { balance: formatUZS(res.data.balance) }));
      form.reset({ patientId: patient?.id ?? '', amount: '', note: '' });
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PiggyBank className="h-5 w-5 text-muted-foreground" />
          {t('deposit.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>{t('deposit.patient')}</Label>
            <PatientCombobox
              value={patient}
              clearable
              onChange={(p) => {
                setPatient(p);
                form.setValue('patientId', p?.id ?? '', { shouldValidate: true });
              }}
            />
            {form.formState.errors.patientId ? (
              <p className="text-sm text-destructive">{tb('form.patientRequired')}</p>
            ) : null}
          </div>

          {patient && balance ? (
            <p className="text-sm text-muted-foreground">
              {t('deposit.currentBalance')}:{' '}
              <span className="font-semibold text-foreground">{formatUZS(balance.balance)}</span>
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="deposit-amount">{t('deposit.amount')}</Label>
            <Input
              id="deposit-amount"
              inputMode="decimal"
              autoComplete="off"
              className="text-lg font-semibold"
              {...form.register('amount', { setValueAs: sanitizeMoney })}
            />
            {form.formState.errors.amount ? (
              <p className="text-sm text-destructive">{tb('form.invalidAmount')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="deposit-note">{t('deposit.note')}</Label>
            <Input id="deposit-note" autoComplete="off" {...form.register('note')} />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending || !can('payments.create')}
          >
            {t('deposit.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
