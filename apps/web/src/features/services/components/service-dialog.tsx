'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { ServiceKind, createServiceSchema, type CreateServiceInput } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
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
  const [catalogPick, setCatalogPick] = useState<{ code: string; label: string } | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');

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
    setCatalogPick(null);
    setCatalogQuery('');
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

  const onSubmit = form.handleSubmit((values) =>
    mutation.mutate(catalogPick ? { ...values, labCatalogCode: catalogPick.code } : values),
  );
  const categoryId = form.watch('categoryId');
  const activeKind = useMemo(
    () => categories.find((c) => c.id === categoryId)?.kind ?? null,
    [categories, categoryId],
  );
  const isLab = activeKind === ServiceKind.LAB;

  const catalogSearch = useQuery({
    queryKey: ['services', 'lab-catalog-pick', catalogQuery],
    queryFn: async () =>
      (
        await api.get<
          Array<{ code: string; name: { uz: string; ru?: string }; parameterCount: number; imported?: boolean }>
        >('/lab-catalog', { search: catalogQuery || undefined, limit: 8 })
      ).data,
    enabled: open && !isEdit && isLab && catalogQuery.trim().length >= 2,
  });

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

          {/* A LAB service starts in the standard catalogue: pick the test and the
              name, code, analytes and reference intervals all come with it. Typing
              it by hand stays possible — the catalogue does not know every test. */}
          {!isEdit && isLab ? (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <Label>{t('form.labCatalog')}</Label>
              {catalogPick ? (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{catalogPick.label}</span>
                    <span className="text-xs text-muted-foreground">{catalogPick.code}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('form.labCatalogClear')}
                    onClick={() => {
                      // The pick filled these fields; leaving them behind would
                      // create a bare hand-written test wearing a catalogue name.
                      if (form.getValues('code') === catalogPick.code) form.setValue('code', '');
                      if (form.getValues('name.uz') === catalogPick.label)
                        form.setValue('name.uz', '');
                      setCatalogPick(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={catalogQuery}
                      onChange={(e) => setCatalogQuery(e.target.value)}
                      placeholder={t('form.labCatalogPlaceholder')}
                      className="pl-9"
                    />
                  </div>
                  {(catalogSearch.data ?? []).length > 0 ? (
                    <div className="max-h-44 overflow-y-auto rounded-md border bg-background">
                      {(catalogSearch.data ?? []).map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setCatalogPick({ code: c.code, label: c.name.uz });
                            form.setValue('code', c.code, { shouldValidate: true });
                            form.setValue('name.uz', c.name.uz, { shouldValidate: true });
                            if (c.name.ru) form.setValue('name.ru', c.name.ru);
                          }}
                        >
                          <span className="truncate">{c.name.uz}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {c.imported ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {t('form.labCatalogTaken')}
                              </Badge>
                            ) : null}
                            <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : catalogQuery.trim().length >= 2 && catalogSearch.isFetched ? (
                    <p className="text-xs text-muted-foreground">{t('form.labCatalogEmpty')}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('form.labCatalogHint')}</p>
                  )}
                </>
              )}
            </div>
          ) : null}

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
