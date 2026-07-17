'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  DiscountType,
  discountRuleUpsertSchema,
  type DiscountRuleUpsertInput,
} from '@avishifo/shared';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { emptyToUndefined, sanitizeMoney, servicesApi, type DiscountRuleRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface DiscountRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; otherwise edit this rule. */
  rule: DiscountRuleRow | null;
}

export function DiscountRuleDialog({ open, onOpenChange, rule }: DiscountRuleDialogProps) {
  const t = useTranslations('services');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = rule !== null;

  const form = useForm<DiscountRuleUpsertInput>({
    resolver: zodResolver(discountRuleUpsertSchema),
    defaultValues: {
      name: '',
      type: DiscountType.PERCENT,
      value: '',
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (rule) {
      form.reset({
        name: rule.name,
        type: rule.type,
        value: rule.value,
        patientTag: rule.patientTag ?? undefined,
        promoCode: rule.promoCode ?? undefined,
        isActive: rule.isActive,
      });
    } else {
      form.reset({
        name: '',
        type: DiscountType.PERCENT,
        value: '',
        patientTag: undefined,
        promoCode: undefined,
        isActive: true,
      });
    }
  }, [open, rule]);

  const mutation = useMutation({
    mutationFn: (values: DiscountRuleUpsertInput) =>
      rule ? servicesApi.updateDiscountRule(rule.id, values) : servicesApi.createDiscountRule(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discount-rules'] });
      toast.success(isEdit ? t('discounts.updated') : t('discounts.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
  const type = form.watch('type');
  const isActive = form.watch('isActive') ?? true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('discounts.form.editTitle') : t('discounts.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="rule-name">{t('discounts.form.name')}</Label>
            <Input id="rule-name" autoComplete="off" {...form.register('name')} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('discounts.form.type')}</Label>
              <Select
                value={type}
                onValueChange={(v) => form.setValue('type', v as DiscountType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(DiscountType).map((dt) => (
                    <SelectItem key={dt} value={dt}>
                      {t(`discounts.types.${dt}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-value">
                {type === DiscountType.PERCENT
                  ? t('discounts.form.valuePercent')
                  : t('discounts.form.valueFixed')}
              </Label>
              <Input
                id="rule-value"
                inputMode="decimal"
                autoComplete="off"
                {...form.register('value', { setValueAs: sanitizeMoney })}
              />
              {form.formState.errors.value ? (
                <p className="text-sm text-destructive">{t('form.invalidPrice')}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rule-tag">{t('discounts.form.patientTag')}</Label>
              <Input
                id="rule-tag"
                autoComplete="off"
                {...form.register('patientTag', { setValueAs: emptyToUndefined })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-promo">{t('discounts.form.promoCode')}</Label>
              <Input
                id="rule-promo"
                autoComplete="off"
                {...form.register('promoCode', { setValueAs: emptyToUndefined })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="rule-active">{t('discounts.form.isActive')}</Label>
            <Switch
              id="rule-active"
              checked={isActive}
              onCheckedChange={(checked) => form.setValue('isActive', checked)}
            />
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
