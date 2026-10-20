'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { localizedText } from '@/lib/localized';
import { toast } from 'sonner';
import {
  CompensationType,
  compensationRuleUpsertSchema,
  type CompensationRuleUpsertInput,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { tashkentToUtcIso, todayTashkent } from '@/lib/dates';
import { sanitizeMoney, staffApi } from '../api';
import { useApiErrorToast, useServiceCategoryOptions, useServiceOptions } from '../hooks';

const COMPENSATION_TYPES: CompensationType[] = [
  CompensationType.FIXED_SALARY,
  CompensationType.REVENUE_PERCENT,
  CompensationType.PER_SERVICE_FEE,
];

type Scope = 'all' | 'service' | 'category';

export interface CompensationRuleDialogProps {
  doctorUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompensationRuleDialog({
  doctorUserId,
  open,
  onOpenChange,
}: CompensationRuleDialogProps) {
  const t = useTranslations('staff');
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<Scope>('all');
  const [effectiveDate, setEffectiveDate] = useState(() => todayTashkent());

  const categoriesQuery = useServiceCategoryOptions(open);
  const servicesQuery = useServiceOptions(open);

  const form = useForm<CompensationRuleUpsertInput>({
    resolver: zodResolver(compensationRuleUpsertSchema),
    defaultValues: {
      doctorUserId,
      type: CompensationType.FIXED_SALARY,
      value: '',
      effectiveFrom: tashkentToUtcIso(todayTashkent(), '00:00'),
    },
  });

  useEffect(() => {
    if (!open) return;
    setScope('all');
    setEffectiveDate(todayTashkent());
    form.reset({
      doctorUserId,
      type: CompensationType.FIXED_SALARY,
      value: '',
      effectiveFrom: tashkentToUtcIso(todayTashkent(), '00:00'),
    });
  }, [open, doctorUserId]);

  const mutation = useMutation({
    mutationFn: (values: CompensationRuleUpsertInput) => staffApi.createRule(values),
    onSuccess: () => {
      toast.success(t('compensation.created'));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'compensation-rules'] });
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) =>
    mutation.mutate({
      ...values,
      serviceId: scope === 'service' ? values.serviceId : undefined,
      serviceCategoryId: scope === 'category' ? values.serviceCategoryId : undefined,
    }),
  );

  const type = form.watch('type');
  const serviceId = form.watch('serviceId');
  const serviceCategoryId = form.watch('serviceCategoryId');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('compensation.addTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>{t('compensation.type')}</Label>
            <Select
              value={type}
              onValueChange={(v) =>
                form.setValue('type', v as CompensationType, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPENSATION_TYPES.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    {enumLabel('compensation', ty)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-value">
              {type === CompensationType.REVENUE_PERCENT
                ? t('compensation.valuePercent')
                : t('compensation.valueAmount')}
            </Label>
            <Input
              id="rule-value"
              inputMode="decimal"
              autoComplete="off"
              {...form.register('value', { setValueAs: sanitizeMoney })}
            />
            {form.formState.errors.value ? (
              <p className="text-sm text-destructive">{t('form.invalidAmount')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{t('compensation.scope')}</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('compensation.scopeAll')}</SelectItem>
                <SelectItem value="service">{t('compensation.scopeService')}</SelectItem>
                <SelectItem value="category">{t('compensation.scopeCategory')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === 'service' ? (
            <div className="space-y-2">
              <Label>{t('compensation.service')}</Label>
              <Select
                value={serviceId ?? undefined}
                onValueChange={(v) => form.setValue('serviceId', v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('compensation.selectService')} />
                </SelectTrigger>
                <SelectContent>
                  {(servicesQuery.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} · {localizedText(s.name, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {scope === 'category' ? (
            <div className="space-y-2">
              <Label>{t('compensation.category')}</Label>
              <Select
                value={serviceCategoryId ?? undefined}
                onValueChange={(v) =>
                  form.setValue('serviceCategoryId', v, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('compensation.selectCategory')} />
                </SelectTrigger>
                <SelectContent>
                  {(categoriesQuery.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {localizedText(c.name, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="rule-effective-from">{t('compensation.effectiveFrom')}</Label>
            <Input
              id="rule-effective-from"
              type="date"
              value={effectiveDate}
              onChange={(e) => {
                const v = e.target.value;
                setEffectiveDate(v);
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                  form.setValue('effectiveFrom', tashkentToUtcIso(v, '00:00'), {
                    shouldValidate: true,
                  });
                }
              }}
            />
            {form.formState.errors.effectiveFrom ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
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
