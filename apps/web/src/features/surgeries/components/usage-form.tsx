'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatUZS, type AddSurgeryEntriesInput } from '@avishifo/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useApiErrorToast } from '@/features/services/hooks';
import { localizedText } from '@/lib/localized';
import { surgeriesApi } from '../api';
import { useInvalidateSurgeries } from '../hooks';
import { identifySurgeryRequest, type SurgeryRequestKey } from '../request-key';
import {
  emptyUsageRow,
  serializeUsageRows,
  usageRowsTotals,
  validateUsageRows,
  type UsageDraftField,
  type UsageDraftRow,
} from '../usage-draft';
import { SurgeryCataloguePicker } from './catalogue-picker';

export function SurgeryUsageForm({
  open,
  onOpenChange,
  surgeryId,
  kind,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  surgeryId: string;
  kind: 'MATERIAL' | 'ANESTHESIA';
}) {
  const t = useTranslations('surgeries');
  const locale = useLocale();
  const [discardOpen, setDiscardOpen] = useState(false);
  const identity = useRef<SurgeryRequestKey | null>(null);
  const invalidate = useInvalidateSurgeries();
  const onError = useApiErrorToast();
  const form = useForm<{ items: UsageDraftRow[] }>({
    defaultValues: { items: [emptyUsageRow()] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const rows = useWatch({ control: form.control, name: 'items' });
  const totals = usageRowsTotals(rows);
  useEffect(() => {
    if (open) {
      identity.current = null;
      setDiscardOpen(false);
      form.reset({ items: [emptyUsageRow()] });
    }
  }, [open, kind, surgeryId, form]);
  const save = useMutation({
    mutationFn: (body: AddSurgeryEntriesInput) => surgeriesApi.addEntries(surgeryId, body),
    onError,
    onSuccess: (_data, body) => {
      invalidate();
      toast.success(t('batch.saved', { count: body.items.length }));
      identity.current = null;
      onOpenChange(false);
    },
  });
  const requestClose = (next: boolean) => {
    if (save.isPending) return;
    if (!next && form.formState.isDirty) setDiscardOpen(true);
    else onOpenChange(next);
  };
  const submit = form.handleSubmit((values) => {
    if (save.isPending) return;
    form.clearErrors();
    const errors = validateUsageRows(values.items, kind);
    if (errors.length) {
      for (const { index, field } of errors) {
        const message = t(`batch.errors.${field}`);
        if (field === 'items') form.setError('root.items', { message });
        else form.setError(`items.${index}.${field}`, { message });
      }
      return;
    }
    const payload = serializeUsageRows(values.items, kind);
    identity.current = identifySurgeryRequest(payload, identity.current);
    save.mutate({ ...payload, idempotencyKey: identity.current.key });
  });
  const setSource = (index: number, source: UsageDraftRow['source']) => {
    if (save.isPending) return;
    form.setValue(`items.${index}.source`, source, { shouldDirty: true });
    form.setValue(`items.${index}.service`, null, { shouldDirty: true });
    form.setValue(`items.${index}.title`, '', { shouldDirty: true });
    form.setValue(`items.${index}.unit`, 'dona', { shouldDirty: true });
    form.setValue(`items.${index}.unitPrice`, '', { shouldDirty: true });
    form.clearErrors(`items.${index}`);
  };
  const fieldError = (index: number, field: Exclude<UsageDraftField, 'items'>) =>
    form.getFieldState(`items.${index}.${field}`, form.formState).error?.message;

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
            <DialogTitle>{t(kind === 'MATERIAL' ? 'addMaterial' : 'addAnesthesia')}</DialogTitle>
            <DialogDescription>{t('batch.hint')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
                {fields.map((field, index) => {
                  const row = rows[index] ?? field;
                  const prefix = `usage-${field.id}`;
                  const errorProps = (name: Exclude<UsageDraftField, 'items'>) => ({
                    'aria-invalid': Boolean(fieldError(index, name)),
                    'aria-describedby': fieldError(index, name)
                      ? `${prefix}-${name}-error`
                      : undefined,
                  });
                  const error = (name: Exclude<UsageDraftField, 'items'>) => {
                    const message = fieldError(index, name);
                    return message ? (
                      <p
                        id={`${prefix}-${name}-error`}
                        className="text-xs text-destructive"
                        role="alert"
                      >
                        {message}
                      </p>
                    ) : null;
                  };
                  return (
                    <section
                      key={field.id}
                      className="space-y-4 rounded-xl border p-4"
                      aria-labelledby={`${prefix}-heading`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 id={`${prefix}-heading`} className="text-sm font-semibold">
                          {t(kind === 'MATERIAL' ? 'batch.materialRow' : 'batch.anesthesiaRow', {
                            count: index + 1,
                          })}
                        </h3>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={save.isPending || fields.length === 1}
                          aria-label={t('batch.removeRow', { count: index + 1 })}
                          onClick={() => {
                            if (!save.isPending && fields.length > 1) remove(index);
                          }}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" />
                          {t('remove')}
                        </Button>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                        <div className="space-y-2">
                          <Label htmlFor={`${prefix}-source`}>{t('batch.source')}</Label>
                          <Select
                            value={row.source}
                            disabled={save.isPending}
                            onValueChange={(value) =>
                              setSource(index, value as UsageDraftRow['source'])
                            }
                          >
                            <SelectTrigger id={`${prefix}-source`} {...errorProps('source')}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CATALOGUE">{t('catalogue')}</SelectItem>
                              <SelectItem value="MANUAL">{t('manual')}</SelectItem>
                            </SelectContent>
                          </Select>
                          {error('source')}
                        </div>
                        <div className="min-w-0 space-y-2">
                          <Label
                            htmlFor={`${prefix}-${row.source === 'CATALOGUE' ? 'service' : 'title'}`}
                          >
                            {t('itemName')}
                          </Label>
                          {row.source === 'CATALOGUE' ? (
                            <SurgeryCataloguePicker
                              id={`${prefix}-service`}
                              disabled={save.isPending}
                              invalid={Boolean(fieldError(index, 'service'))}
                              describedBy={errorProps('service')['aria-describedby']}
                              kind={kind === 'MATERIAL' ? 'MATERIAL' : 'MEDICINE'}
                              value={row.service}
                              onChange={(service) => {
                                if (save.isPending) return;
                                form.setValue(`items.${index}.service`, service, {
                                  shouldDirty: true,
                                });
                                form.setValue(
                                  `items.${index}.title`,
                                  localizedText(service.name, locale),
                                  { shouldDirty: true },
                                );
                                form.setValue(`items.${index}.unit`, service.unit, {
                                  shouldDirty: true,
                                });
                                form.setValue(
                                  `items.${index}.unitPrice`,
                                  service.currentPrice ?? '',
                                  { shouldDirty: true },
                                );
                                form.clearErrors(`items.${index}.service`);
                              }}
                            />
                          ) : (
                            <Input
                              id={`${prefix}-title`}
                              maxLength={200}
                              {...form.register(`items.${index}.title`)}
                              {...errorProps('title')}
                            />
                          )}
                          {error(row.source === 'CATALOGUE' ? 'service' : 'title')}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div className="space-y-2">
                          <Label htmlFor={`${prefix}-quantity`}>{t('quantity')}</Label>
                          <Input
                            id={`${prefix}-quantity`}
                            inputMode="decimal"
                            {...form.register(`items.${index}.quantity`)}
                            {...errorProps('quantity')}
                          />
                          {error('quantity')}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`${prefix}-unit`}>{t('unit')}</Label>
                          <Input
                            id={`${prefix}-unit`}
                            maxLength={30}
                            readOnly={row.source === 'CATALOGUE'}
                            {...form.register(`items.${index}.unit`)}
                            {...errorProps('unit')}
                          />
                          {error('unit')}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`${prefix}-unitPrice`}>{t('unitPrice')}</Label>
                          <Input
                            id={`${prefix}-unitPrice`}
                            inputMode="decimal"
                            readOnly={row.source === 'CATALOGUE'}
                            {...form.register(`items.${index}.unitPrice`)}
                            {...errorProps('unitPrice')}
                          />
                          {error('unitPrice')}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`${prefix}-total`}>{t('lineTotal')}</Label>
                          <output
                            id={`${prefix}-total`}
                            className="flex min-h-10 items-center rounded-md bg-muted px-3 py-2 text-sm font-semibold tabular-nums"
                          >
                            {totals.lines[index] != null ? formatUZS(totals.lines[index]!) : '—'}
                          </output>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${prefix}-note`}>{t('note')}</Label>
                        <Input
                          id={`${prefix}-note`}
                          maxLength={500}
                          {...form.register(`items.${index}.note`)}
                          {...errorProps('note')}
                        />
                        {error('note')}
                      </div>
                    </section>
                  );
                })}
              </fieldset>
            </div>
            <div className="sticky bottom-0 shrink-0 space-y-3 border-t bg-background px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending || fields.length >= 50}
                  onClick={() => {
                    if (!save.isPending && fields.length < 50)
                      append(emptyUsageRow(), { shouldFocus: false });
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('batch.addRow')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('batch.count', { count: fields.length })}
                </p>
              </div>
              {Object.keys(form.formState.errors).length ? (
                <p role="alert" className="text-sm text-destructive">
                  {t('batch.invalid')}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{t('batch.total')}</span>
                <strong className="text-lg tabular-nums">
                  {totals.total !== null ? formatUZS(totals.total) : '—'}
                </strong>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => requestClose(false)}
                >
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {t(save.isPending ? 'batch.saving' : 'batch.saveAll', { count: fields.length })}
                </Button>
              </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('batch.discardTitle')}
        description={t('batch.discardHint')}
        confirmLabel={t('batch.discard')}
        cancelLabel={t('batch.keepEditing')}
        destructive
        onConfirm={() => {
          if (save.isPending) return;
          identity.current = null;
          setDiscardOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
