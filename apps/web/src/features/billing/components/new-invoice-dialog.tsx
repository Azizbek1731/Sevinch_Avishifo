'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import {
  createInvoiceSchema,
  formatUZS,
  fromTiyin,
  toTiyin,
  type CreateInvoiceInput,
  type MoneyString,
} from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from '@/i18n/routing';
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
import { Separator } from '@/components/ui/separator';
import { billingApi, sanitizeMoney, type PatientBrief, type ServiceOption } from '../api';
import { useApiErrorToast } from '../hooks';
import { PatientCombobox } from './patient-combobox';
import { ServiceCombobox } from './service-combobox';

const EMPTY_LINE = { quantity: 1, unitPrice: '0' as MoneyString, discount: '0' as MoneyString };

function lineTotalTiyin(quantity: number, unitPrice: string, discount: string): bigint | null {
  try {
    const qty = BigInt(Math.max(0, Math.trunc(Number.isFinite(quantity) ? quantity : 0)));
    return toTiyin(sanitizeMoney(unitPrice) || '0') * qty - toTiyin(sanitizeMoney(discount) || '0');
  } catch {
    return null;
  }
}

export interface NewInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, the invoice is locked to this patient (used from the patient card
   * for e.g. inpatient / statsionar billing) — the patient picker is hidden.
   */
  lockedPatient?: PatientBrief;
}

export function NewInvoiceDialog({ open, onOpenChange, lockedPatient }: NewInvoiceDialogProps) {
  const t = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const [patient, setPatient] = useState<PatientBrief | null>(lockedPatient ?? null);
  /** Selected service per field-array row, keyed by RHF field id. */
  const [rowServices, setRowServices] = useState<Record<string, ServiceOption | null>>({});

  const form = useForm<CreateInvoiceInput>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      patientId: lockedPatient?.id ?? '',
      branchId: activeBranchId ?? '',
      lines: [{ ...EMPTY_LINE }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });

  useEffect(() => {
    if (open) {
      setPatient(lockedPatient ?? null);
      setRowServices({});
      form.reset({
        patientId: lockedPatient?.id ?? '',
        branchId: activeBranchId ?? '',
        lines: [{ ...EMPTY_LINE }],
      });
    }
  }, [open, activeBranchId, lockedPatient]);

  const mutation = useMutation({
    mutationFn: (values: CreateInvoiceInput) => billingApi.createInvoice(values),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(t('form.created', { number: res.data.number }));
      onOpenChange(false);
      router.push(`/invoices/${res.data.id}`);
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  const watchedLines = form.watch('lines') ?? [];
  const totalTiyin = watchedLines.reduce<bigint>((acc, line) => {
    const lt = lineTotalTiyin(line.quantity, line.unitPrice, line.discount ?? '0');
    return acc + (lt !== null && lt > 0n ? lt : 0n);
  }, 0n);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>{t('form.patient')}</Label>
            {lockedPatient ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-medium">{lockedPatient.fullName}</span>
                <span className="font-mono text-xs text-muted-foreground">{lockedPatient.mrn}</span>
              </div>
            ) : (
              <PatientCombobox
                value={patient}
                onChange={(p) => {
                  setPatient(p);
                  form.setValue('patientId', p?.id ?? '', { shouldValidate: true });
                }}
              />
            )}
            {form.formState.errors.patientId ? (
              <p className="text-sm text-destructive">{t('form.patientRequired')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{t('form.lines')}</Label>
            <div className="space-y-3">
              {fields.map((field, idx) => {
                const line = watchedLines[idx];
                const lt = line ? lineTotalTiyin(line.quantity, line.unitPrice, line.discount ?? '0') : null;
                return (
                  <div
                    key={field.id}
                    className="grid grid-cols-2 items-end gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_80px_140px_140px_120px_36px]"
                  >
                    <div className="col-span-2 min-w-0 space-y-1 md:col-span-1">
                      <span className="text-xs text-muted-foreground">{t('form.service')}</span>
                      <ServiceCombobox
                        value={rowServices[field.id] ?? null}
                        onChange={(s) => {
                          setRowServices((prev) => ({ ...prev, [field.id]: s }));
                          form.setValue(`lines.${idx}.serviceId`, s.id, { shouldValidate: true });
                          form.setValue(`lines.${idx}.unitPrice`, s.currentPrice ?? '0', {
                            shouldValidate: true,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('form.qty')}</span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        {...form.register(`lines.${idx}.quantity`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('form.unitPrice')}</span>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        {...form.register(`lines.${idx}.unitPrice`, { setValueAs: sanitizeMoney })}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('form.discount')}</span>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        {...form.register(`lines.${idx}.discount`, { setValueAs: sanitizeMoney })}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('form.lineTotal')}</span>
                      <p className="truncate text-sm font-semibold leading-9">
                        {lt !== null ? formatUZS(fromTiyin(lt < 0n ? 0n : lt)) : '—'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      disabled={fields.length <= 1}
                      onClick={() => {
                        setRowServices((prev) => {
                          const next = { ...prev };
                          delete next[field.id];
                          return next;
                        });
                        remove(idx);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
            {form.formState.errors.lines ? (
              <p className="text-sm text-destructive">{t('form.linesInvalid')}</p>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => append({ ...EMPTY_LINE })}>
              <Plus className="mr-1 h-4 w-4" />
              {t('form.addLine')}
            </Button>
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t('form.totalPreview')}</span>
            <span className="text-xl font-bold">{formatUZS(fromTiyin(totalTiyin))}</span>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('form.creating') : t('form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
