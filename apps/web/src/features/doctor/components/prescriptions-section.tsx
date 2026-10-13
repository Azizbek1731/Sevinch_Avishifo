'use client';

import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pill, Plus, RefreshCw, Save } from 'lucide-react';
import { replacePrescriptionsSchema } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { ApiError } from '@/lib/api-client';
import { doctorApi, type VisitPrescription } from '../api';
import { useApiErrorToast, useReplacePrescriptions } from '../hooks';
import {
  combinePrescription,
  emptyPrescription,
  isInfusionPrescription,
  prescriptionDraft,
  prescriptionGroupRange,
  prescriptionSyncAction,
  serializePrescriptionDraft,
  type PrescriptionDraft,
  type PrescriptionDraftItem,
} from '../prescription-draft';
import { PrescriptionMedicationCard } from './prescription-medication-card';
import { PrescriptionPreview } from './prescription-preview';

type EditorAction =
  { kind: 'reload' } | { kind: 'remove' | 'combine'; rowId: string; count: number };

export function PrescriptionsSection({
  visitId,
  prescriptions,
  prescriptionRevision,
  physiotherapy,
  disabled,
  onUnsavedChange,
}: {
  visitId: string;
  prescriptions: VisitPrescription[];
  prescriptionRevision: number;
  physiotherapy: string | null;
  disabled: boolean;
  onUnsavedChange?: (value: boolean) => void;
}) {
  const t = useTranslations('visits');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const save = useReplacePrescriptions(visitId);
  const loadedVisit = useRef(visitId);
  const [loadedRevision, setLoadedRevision] = useState(prescriptionRevision);
  const [conflict, setConflict] = useState(false);
  const [action, setAction] = useState<EditorAction | null>(null);
  const form = useForm<PrescriptionDraft>({
    defaultValues: prescriptionDraft(prescriptions, physiotherapy),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const dirty = form.formState.isDirty;
  const items = form.watch('items');
  const hydrate = (data: {
    prescriptions: VisitPrescription[];
    prescriptionRevision: number;
    physiotherapy: string | null;
  }) => {
    form.reset(prescriptionDraft(data.prescriptions, data.physiotherapy));
    setLoadedRevision(data.prescriptionRevision);
    setConflict(false);
    setAction(null);
  };
  const reload = useMutation({
    mutationKey: ['visits', visitId],
    mutationFn: () => doctorApi.getVisit(visitId),
    onError: errorToast,
    onSuccess: (response) => {
      hydrate(response.data);
      queryClient.setQueryData(['visits', visitId], response);
    },
  });
  const pending = save.isPending || reload.isPending;
  const editingDisabled = disabled || pending;

  useEffect(() => {
    onUnsavedChange?.(dirty || pending);
  }, [dirty, pending, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange]);
  useEffect(() => {
    if (loadedVisit.current !== visitId) {
      loadedVisit.current = visitId;
      hydrate({ prescriptions, prescriptionRevision, physiotherapy });
      return;
    }
    const sync = prescriptionSyncAction(loadedRevision, prescriptionRevision, dirty, pending);
    if (sync === 'hydrate') hydrate({ prescriptions, prescriptionRevision, physiotherapy });
    if (sync === 'conflict') setConflict(true);
  }, [visitId, prescriptionRevision, prescriptions, physiotherapy, loadedRevision, dirty, pending]);

  const changeRow = (index: number, patch: Partial<PrescriptionDraftItem>) => {
    if (editingDisabled) return;
    form.setValue(
      `items.${index}`,
      { ...form.getValues(`items.${index}`), ...patch },
      { shouldDirty: true },
    );
    form.clearErrors();
  };
  const onSave = form.handleSubmit((values) => {
    if (editingDisabled || conflict) return;
    const parsed = replacePrescriptionsSchema.safeParse(
      serializePrescriptionDraft(values, loadedRevision),
    );
    if (!parsed.success) {
      form.setError('root', { message: t('rx.invalid') });
      for (const issue of parsed.error.issues) {
        if (
          issue.path[0] === 'items' &&
          typeof issue.path[1] === 'number' &&
          issue.path[2] === 'drugName'
        )
          form.setError(`items.${issue.path[1]}.drugName`, { message: t('drugRequired') });
      }
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: (response) => hydrate(response.data),
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) setConflict(true);
      },
    });
  });
  const confirmAction = () => {
    if (!action || editingDisabled) return;
    if (action.kind === 'reload') {
      reload.mutate();
      setAction(null);
      return;
    }
    const index = fields.findIndex((field) => field.id === action.rowId);
    if (index < 0) {
      setAction(null);
      return;
    }
    if (action.kind === 'combine')
      changeRow(index, combinePrescription(form.getValues(`items.${index}`), true));
    else {
      const range = prescriptionGroupRange(form.getValues('items'), index);
      remove(range);
    }
    form.clearErrors();
    setAction(null);
  };
  const physioRaw: unknown = t.raw('rx.options.physioSuggest');
  const physioSuggestions = Array.isArray(physioRaw)
    ? physioRaw.filter((item): item is string => typeof item === 'string')
    : [];
  let groupNumber = 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{t('prescriptions')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(disabled ? 'rx.readOnlyHint' : 'rx.editorHint')}
            </p>
          </div>
          {!disabled ? (
            <span
              className={`text-xs font-medium ${dirty ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
            >
              {t(dirty ? 'rx.unsaved' : 'rx.savedState')}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled ? (
          <>
            {prescriptions.length ? (
              <PrescriptionPreview items={prescriptions} />
            ) : (
              <EmptyState icon={Pill} title={t('noPrescriptions')} className="py-6" />
            )}
            {physiotherapy ? (
              <section className="rounded-lg border p-4">
                <h3 className="mb-2 text-sm font-semibold">{t('rx.physiotherapy')}</h3>
                <p className="whitespace-pre-wrap text-sm">{physiotherapy}</p>
              </section>
            ) : null}
            {dirty ? (
              <p className="rounded-lg border border-amber-300 p-3 text-sm">
                {t('rx.lockedDraft')}
              </p>
            ) : null}
          </>
        ) : (
          <form onSubmit={onSave} className="space-y-4" noValidate>
            {conflict ? (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              >
                <p className="font-semibold">{t('rx.conflictTitle')}</p>
                <p>{t('rx.conflictHint')}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setAction({ kind: 'reload' })}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t('rx.reload')}
                </Button>
              </div>
            ) : null}
            <fieldset disabled={editingDisabled} className="space-y-4">
              {fields.map((field, index) => {
                const item = items[index] ?? emptyPrescription();
                if (!item.combineWithPrevious) groupNumber++;
                return (
                  <PrescriptionMedicationCard
                    key={field.id}
                    item={item}
                    index={index}
                    number={groupNumber}
                    disabled={editingDisabled}
                    showDrip={isInfusionPrescription(items, index)}
                    invalid={Boolean(form.formState.errors.items?.[index]?.drugName)}
                    onChange={(patch) => changeRow(index, patch)}
                    onCombine={(combined) => {
                      if (index === 0) return;
                      if (combined)
                        setAction({
                          kind: 'combine',
                          rowId: field.id,
                          count: prescriptionGroupRange(items, index).length,
                        });
                      else changeRow(index, combinePrescription(item, false));
                    }}
                    onRemove={() =>
                      setAction({
                        kind: 'remove',
                        rowId: field.id,
                        count: prescriptionGroupRange(items, index).length,
                      })
                    }
                  />
                );
              })}
              {fields.length === 0 ? (
                <EmptyState
                  icon={Pill}
                  title={t('noPrescriptions')}
                  description={t('rx.emptyHint')}
                  className="py-7"
                />
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                disabled={editingDisabled || fields.length >= 40}
                onClick={() => {
                  append(emptyPrescription());
                  form.clearErrors();
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('rx.addMedication')}
              </Button>
              <section className="space-y-2 rounded-xl border p-4">
                <Label htmlFor={`physio-${visitId}`}>{t('rx.physiotherapy')}</Label>
                <Textarea
                  id={`physio-${visitId}`}
                  rows={3}
                  maxLength={10000}
                  placeholder={t('rx.physiotherapyPlaceholder')}
                  {...form.register('physiotherapy')}
                />
                <div className="flex flex-wrap gap-2">
                  {physioSuggestions.map((suggestion) => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto whitespace-normal rounded-full px-3 py-1 text-xs"
                      key={suggestion}
                      onClick={() => {
                        const existing = form.getValues('physiotherapy').trim();
                        if (!existing.split('\n').includes(suggestion))
                          form.setValue(
                            'physiotherapy',
                            [existing, suggestion].filter(Boolean).join('\n'),
                            { shouldDirty: true },
                          );
                      }}
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('rx.physiotherapyHint')}</p>
              </section>
            </fieldset>
            {items.length ? (
              <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <h3 className="text-sm font-semibold">{t('rx.preview')}</h3>
                <PrescriptionPreview items={items} compact />
              </section>
            ) : null}
            {form.formState.errors.root ? (
              <p role="alert" className="text-sm text-destructive">
                {t('rx.invalid')}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="max-w-xl text-xs text-muted-foreground">{t('rx.saveHint')}</p>
              <div className="flex gap-2">
                {dirty && !conflict ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setAction({ kind: 'reload' })}
                  >
                    {t('rx.discard')}
                  </Button>
                ) : null}
                <Button type="submit" disabled={editingDisabled || !dirty || conflict}>
                  <Save className="mr-2 h-4 w-4" />
                  {t(pending ? 'rx.saving' : 'rx.save')}
                </Button>
              </div>
            </div>
          </form>
        )}
        <ConfirmDialog
          open={action !== null}
          onOpenChange={(open) => {
            if (!open && !pending) setAction(null);
          }}
          title={t(
            action?.kind === 'reload'
              ? 'rx.discardTitle'
              : action?.kind === 'combine'
                ? 'rx.combineTitle'
                : action?.kind === 'remove' && action.count > 1
                  ? 'rx.removeGroupTitle'
                  : 'rx.removeMedication',
          )}
          description={t(
            action?.kind === 'reload'
              ? 'rx.discardHint'
              : action?.kind === 'combine'
                ? action.count > 1
                  ? 'rx.combineGroupHint'
                  : 'rx.combineHint'
                : action?.kind === 'remove' && action.count > 1
                  ? 'rx.removeGroupHint'
                  : 'rx.removeHint',
            { count: action && action.kind !== 'reload' ? action.count : 0 },
          )}
          confirmLabel={t(
            action?.kind === 'reload'
              ? 'rx.reload'
              : action?.kind === 'combine'
                ? 'rx.combineConfirm'
                : 'rx.removeConfirm',
          )}
          cancelLabel={tc('cancel')}
          destructive={action?.kind !== 'combine'}
          onConfirm={confirmAction}
        />
      </CardContent>
    </Card>
  );
}
