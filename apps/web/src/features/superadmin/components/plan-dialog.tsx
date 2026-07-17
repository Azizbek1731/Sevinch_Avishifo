'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { planUpsertSchema, type PlanUpsertInput } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { superadminApi, PLAN_MODULE_KEYS, type PlanRow } from '../api';
import { useApiErrorToast } from '../hooks';

/** Keep only digits and one dot so "1 500 000" passes moneySchema. */
function sanitizeMoney(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s/g, '').replace(',', '.') : '';
}

const EMPTY_VALUES: PlanUpsertInput = {
  code: '',
  name: '',
  priceMonthly: '',
  maxBranches: 1,
  maxUsers: 5,
  modules: [],
};

export interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; otherwise edit this plan (upsert keyed by its code). */
  plan: PlanRow | null;
}

export function PlanDialog({ open, onOpenChange, plan }: PlanDialogProps) {
  const t = useTranslations('superadmin');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = plan !== null;

  const form = useForm<PlanUpsertInput>({
    resolver: zodResolver(planUpsertSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (plan) {
      form.reset({
        code: plan.code,
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        maxBranches: plan.maxBranches,
        maxUsers: plan.maxUsers,
        modules: plan.modules,
      });
    } else {
      form.reset(EMPTY_VALUES);
    }
  }, [open, plan]);

  const mutation = useMutation({
    mutationFn: (values: PlanUpsertInput) => superadminApi.upsertPlan(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
      toast.success(t('plans.saved'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
  const errors = form.formState.errors;
  const modules = form.watch('modules');

  const toggleModule = (key: string, checked: boolean) => {
    const next = checked ? [...modules, key] : modules.filter((m) => m !== key);
    form.setValue('modules', next, { shouldValidate: true });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('plans.dialog.editTitle') : t('plans.dialog.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plan-code">{t('plans.dialog.code')}</Label>
              <Input id="plan-code" autoComplete="off" disabled={isEdit} {...form.register('code')} />
              {errors.code ? <p className="text-sm text-destructive">{t('form.required')}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-name">{t('plans.dialog.name')}</Label>
              <Input id="plan-name" autoComplete="off" {...form.register('name')} />
              {errors.name ? <p className="text-sm text-destructive">{t('form.required')}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="plan-price">{t('plans.dialog.price')}</Label>
            <Input
              id="plan-price"
              inputMode="decimal"
              autoComplete="off"
              {...form.register('priceMonthly', { setValueAs: sanitizeMoney })}
            />
            {errors.priceMonthly ? (
              <p className="text-sm text-destructive">{t('form.invalidPrice')}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plan-max-branches">{t('plans.dialog.maxBranches')}</Label>
              <Input
                id="plan-max-branches"
                type="number"
                min={1}
                step={1}
                {...form.register('maxBranches', { valueAsNumber: true })}
              />
              {errors.maxBranches ? (
                <p className="text-sm text-destructive">{t('form.invalidNumber')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-max-users">{t('plans.dialog.maxUsers')}</Label>
              <Input
                id="plan-max-users"
                type="number"
                min={1}
                step={1}
                {...form.register('maxUsers', { valueAsNumber: true })}
              />
              {errors.maxUsers ? (
                <p className="text-sm text-destructive">{t('form.invalidNumber')}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('plans.dialog.modules')}</Label>
            <div className="grid grid-cols-2 gap-2">
              {PLAN_MODULE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <Checkbox
                    checked={modules.includes(key)}
                    onCheckedChange={(c) => toggleModule(key, c === true)}
                  />
                  {t(`detail.flags.${key}` as never)}
                </label>
              ))}
            </div>
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
      </DialogContent>
    </Dialog>
  );
}
