'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createServiceSchema, type CreateServiceInput } from '@avishifo/shared';
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
import { emptyToUndefined, sanitizeMoney, servicesApi, type ServiceCategoryRow, type ServiceRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface ServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ServiceCategoryRow[];
  /** null → create; otherwise edit this service. */
  service: ServiceRow | null;
  /** Preselected category for the create form. */
  defaultCategoryId: string | null;
}

export function ServiceDialog({
  open,
  onOpenChange,
  categories,
  service,
  defaultCategoryId,
}: ServiceDialogProps) {
  const t = useTranslations('services');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = service !== null;

  const form = useForm<CreateServiceInput>({
    resolver: zodResolver(createServiceSchema),
    defaultValues: {
      categoryId: '',
      code: '',
      name: { uz: '' },
      durationMin: 15,
      vatIncluded: true,
      price: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    if (service) {
      form.reset({
        categoryId: service.categoryId,
        code: service.code,
        name: { uz: service.name.uz, ru: service.name.ru },
        durationMin: service.durationMin,
        vatIncluded: service.vatIncluded,
        // Required by the create schema; PATCH ignores it (prices are effective-dated).
        price: service.currentPrice ?? '0',
      });
    } else {
      form.reset({
        categoryId: defaultCategoryId ?? '',
        code: '',
        name: { uz: '' },
        durationMin: 15,
        vatIncluded: true,
        price: '',
      });
    }
  }, [open, service, defaultCategoryId]);

  const mutation = useMutation({
    mutationFn: (values: CreateServiceInput) => {
      if (service) {
        const { categoryId, code, name, durationMin, vatIncluded } = values;
        return servicesApi.updateService(service.id, {
          categoryId,
          code,
          name,
          durationMin,
          vatIncluded,
        });
      }
      return servicesApi.createService(values);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success(isEdit ? t('form.updated') : t('form.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
  const categoryId = form.watch('categoryId');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>{t('form.category')}</Label>
            <Select
              value={categoryId || undefined}
              onValueChange={(v) => form.setValue('categoryId', v, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('form.selectCategory')} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.categoryId ? (
              <p className="text-sm text-destructive">{t('form.categoryRequired')}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="service-code">{t('form.code')}</Label>
              <Input id="service-code" autoComplete="off" {...form.register('code')} />
              {form.formState.errors.code ? (
                <p className="text-sm text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-duration">{t('form.duration')}</Label>
              <Input
                id="service-duration"
                type="number"
                min={1}
                step={1}
                {...form.register('durationMin', { valueAsNumber: true })}
              />
              {form.formState.errors.durationMin ? (
                <p className="text-sm text-destructive">{t('form.invalidDuration')}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-name-uz">{t('form.nameUz')}</Label>
            <Input id="service-name-uz" autoComplete="off" {...form.register('name.uz')} />
            {form.formState.errors.name?.uz ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-name-ru">{t('form.nameRu')}</Label>
            <Input
              id="service-name-ru"
              autoComplete="off"
              {...form.register('name.ru', { setValueAs: emptyToUndefined })}
            />
          </div>

          {!isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="service-price">{t('form.price')}</Label>
              <Input
                id="service-price"
                inputMode="decimal"
                autoComplete="off"
                {...form.register('price', { setValueAs: sanitizeMoney })}
              />
              {form.formState.errors.price ? (
                <p className="text-sm text-destructive">{t('form.invalidPrice')}</p>
              ) : null}
            </div>
          ) : null}

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
