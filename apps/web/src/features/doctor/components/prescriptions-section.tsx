'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Pill, Trash2 } from 'lucide-react';
import { addPrescriptionSchema, type AddPrescriptionInput } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import type { VisitPrescription } from '../api';
import { useAddPrescription, useDrugSearch, useRemovePrescription } from '../hooks';

export function PrescriptionsSection({
  visitId,
  prescriptions,
  disabled,
}: {
  visitId: string;
  prescriptions: VisitPrescription[];
  disabled: boolean;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');

  const addPrescription = useAddPrescription(visitId);
  const removePrescription = useRemovePrescription(visitId);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const form = useForm<AddPrescriptionInput>({
    resolver: zodResolver(addPrescriptionSchema),
    defaultValues: { drugName: '', dosage: '', frequency: '', instructions: '' },
  });

  const drugName = form.watch('drugName');
  const { data: suggestions } = useDrugSearch(suggestionsOpen ? drugName : '');

  const onSubmit = form.handleSubmit((values) => {
    addPrescription.mutate(
      {
        drugName: values.drugName,
        drugId: values.drugId,
        dosage: values.dosage?.trim() || undefined,
        frequency: values.frequency?.trim() || undefined,
        durationDays: values.durationDays,
        instructions: values.instructions?.trim() || undefined,
      },
      {
        onSuccess: () => {
          form.reset({ drugName: '', dosage: '', frequency: '', instructions: '' });
        },
      },
    );
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('prescriptions')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!disabled ? (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative space-y-1.5 lg:col-span-2">
                <Label htmlFor="rx-drug">{t('drug')}</Label>
                <Input
                  id="rx-drug"
                  autoComplete="off"
                  placeholder={t('drugPlaceholder')}
                  {...form.register('drugName', {
                    onChange: () => {
                      form.setValue('drugId', undefined);
                      setSuggestionsOpen(true);
                    },
                  })}
                  onFocus={() => setSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setSuggestionsOpen(false), 150)}
                />
                {suggestionsOpen && (suggestions?.length ?? 0) > 0 ? (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                    {(suggestions ?? []).map((drug) => (
                      <li key={drug.id}>
                        <button
                          type="button"
                          className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            form.setValue('drugName', drug.name, { shouldValidate: true });
                            form.setValue('drugId', drug.id);
                            setSuggestionsOpen(false);
                          }}
                        >
                          {drug.name}
                          {drug.strength ? (
                            <span className="text-muted-foreground"> · {drug.strength}</span>
                          ) : null}
                          {drug.form ? (
                            <span className="text-muted-foreground"> · {drug.form}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {form.formState.errors.drugName ? (
                  <p className="text-xs text-destructive">{t('drugRequired')}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-dosage">{t('dosage')}</Label>
                <Input id="rx-dosage" {...form.register('dosage')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-frequency">{t('frequency')}</Label>
                <Input id="rx-frequency" {...form.register('frequency')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rx-duration">{t('durationDays')}</Label>
                <Input
                  id="rx-duration"
                  type="number"
                  min={1}
                  {...form.register('durationDays', {
                    setValueAs: (v: unknown) => {
                      if (v === '' || v === null || v === undefined) return undefined;
                      const n = Number(v);
                      return Number.isNaN(n) ? undefined : n;
                    },
                  })}
                />
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="rx-instructions">{t('instructions')}</Label>
                <Input id="rx-instructions" {...form.register('instructions')} />
              </div>
              <Button type="submit" disabled={addPrescription.isPending}>
                {tCommon('add')}
              </Button>
            </div>
          </form>
        ) : null}

        {prescriptions.length === 0 ? (
          <EmptyState icon={Pill} title={t('noPrescriptions')} className="py-8" />
        ) : (
          <ol className="space-y-2">
            {prescriptions.map((rx, index) => (
              <li
                key={rx.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {index + 1}. {rx.drugName}
                    {rx.dosage ? ` · ${rx.dosage}` : ''}
                    {rx.frequency ? ` · ${rx.frequency}` : ''}
                    {rx.durationDays ? ` · ${t('days', { count: rx.durationDays })}` : ''}
                  </p>
                  {rx.instructions ? (
                    <p className="truncate text-xs text-muted-foreground">{rx.instructions}</p>
                  ) : null}
                </div>
                {!disabled ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tCommon('delete')}
                    onClick={() => setDeleteId(rx.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
        title={tCommon('confirmDeleteTitle')}
        description={tCommon('confirmDeleteDesc')}
        confirmLabel={tCommon('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        onConfirm={() => {
          if (deleteId) removePrescription.mutate(deleteId);
          setDeleteId(null);
        }}
      />
    </Card>
  );
}
