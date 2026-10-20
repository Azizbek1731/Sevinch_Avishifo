'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { createPackageSchema, formatUZS, type CreatePackageInput } from '@avishifo/shared';
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
import { emptyToUndefined, sanitizeMoney, servicesApi, type PackageRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface PackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create; otherwise edit this package. */
  pkg: PackageRow | null;
}

export function PackageDialog({ open, onOpenChange, pkg }: PackageDialogProps) {
  const t = useTranslations('services');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = pkg !== null;

  const { data: servicesData } = useQuery({
    queryKey: ['services', 'all', { isActive: true }],
    queryFn: () => servicesApi.listAllServices({ isActive: true }),
    enabled: open,
  });
  const services = servicesData?.data ?? [];

  const form = useForm<CreatePackageInput>({
    resolver: zodResolver(createPackageSchema),
    defaultValues: {
      code: '',
      name: { uz: '' },
      price: '',
      items: [{ serviceId: '', quantity: 1 }],
    },
  });
  const itemsArray = useFieldArray({ control: form.control, name: 'items' });

  useEffect(() => {
    if (!open) return;
    if (pkg) {
      form.reset({
        code: pkg.code,
        name: { uz: pkg.name.uz, ru: pkg.name.ru },
        price: pkg.price,
        items: pkg.items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity })),
      });
    } else {
      form.reset({
        code: '',
        name: { uz: '' },
        price: '',
        items: [{ serviceId: '', quantity: 1 }],
      });
    }
  }, [open, pkg]);

  const mutation = useMutation({
    mutationFn: (values: CreatePackageInput) =>
      pkg ? servicesApi.updatePackage(pkg.id, values) : servicesApi.createPackage(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-packages'] });
      toast.success(isEdit ? t('packages.updated') : t('packages.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  const watchedItems = form.watch('items');
  const itemsSum = watchedItems.reduce((sum, item) => {
    const svc = services.find((s) => s.id === item.serviceId);
    if (!svc || svc.currentPrice === null) return sum;
    return sum + Number(svc.currentPrice) * (Number.isFinite(item.quantity) ? item.quantity : 0);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('packages.form.editTitle') : t('packages.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="package-code">{t('form.code')}</Label>
              <Input id="package-code" autoComplete="off" {...form.register('code')} />
              {form.formState.errors.code ? (
                <p className="text-sm text-destructive">{t('form.required')}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="package-price">{t('packages.form.price')}</Label>
              <Input
                id="package-price"
                inputMode="decimal"
                autoComplete="off"
                {...form.register('price', { setValueAs: sanitizeMoney })}
              />
              {form.formState.errors.price ? (
                <p className="text-sm text-destructive">{t('form.invalidPrice')}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="package-name-uz">{t('form.nameUz')}</Label>
            <Input id="package-name-uz" autoComplete="off" {...form.register('name.uz')} />
            {form.formState.errors.name?.uz ? (
              <p className="text-sm text-destructive">{t('form.required')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="package-name-ru">{t('form.nameRu')}</Label>
            <Input
              id="package-name-ru"
              autoComplete="off"
              {...form.register('name.ru', { setValueAs: emptyToUndefined })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('packages.form.items')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => itemsArray.append({ serviceId: '', quantity: 1 })}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('packages.form.addItem')}
              </Button>
            </div>

            <div className="space-y-2">
              {itemsArray.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={form.watch(`items.${index}.serviceId`) || undefined}
                      onValueChange={(v) =>
                        form.setValue(`items.${index}.serviceId`, v, { shouldValidate: true })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('packages.form.selectService')} />
                      </SelectTrigger>
                      <SelectContent>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name.uz}
                            {s.currentPrice !== null ? ` — ${formatUZS(s.currentPrice)}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.formState.errors.items?.[index]?.serviceId ? (
                      <p className="mt-1 text-sm text-destructive">{t('form.required')}</p>
                    ) : null}
                  </div>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    className="w-20"
                    aria-label={t('packages.form.quantity')}
                    {...form.register(`items.${index}.quantity`, { valueAsNumber: true })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive"
                    disabled={itemsArray.fields.length <= 1}
                    onClick={() => itemsArray.remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {form.formState.errors.items?.root || form.formState.errors.items?.message ? (
              <p className="text-sm text-destructive">{t('packages.form.itemsRequired')}</p>
            ) : null}

            {itemsSum > 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('packages.form.itemsSum', { sum: formatUZS(itemsSum) })}
              </p>
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
