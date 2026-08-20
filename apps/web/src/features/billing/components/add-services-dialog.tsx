'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Banknote, NotebookPen, Plus, TriangleAlert, Trash2 } from 'lucide-react';
import {
  createInvoiceSchema,
  formatUZS,
  fromTiyin,
  type PaymentPart,
  PaymentMethod,
  toTiyin,
  type CreateInvoiceInput,
  type InvoiceSettlement,
  type MoneyString,
} from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from '@/i18n/routing';
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
import { Separator } from '@/components/ui/separator';
import { billingApi, sanitizeMoney, type PatientBrief, type ServiceOption } from '../api';
import { useApiErrorToast, useInvalidateBilling, usePermission } from '../hooks';
import { PatientCombobox } from './patient-combobox';
import { ReceiptPrinter } from './receipt-printer';
import { PaymentSplit, splitTotalTiyin } from './payment-split';
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

export interface AddServicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed patient (patient card). Omit to let the user pick one (front desk). */
  patient?: PatientBrief | null;
  /** Attach the sale to a visit, so the doctor gets the KPI credit. */
  visitId?: string;
}

/**
 * Front-desk sale: pick services, then either take the money now (a receipt is
 * printed automatically) or put the amount on the patient's account as debt.
 * Both paths go through `POST /invoices/quick`, so the invoice is never left
 * half-created.
 */
export function AddServicesDialog({
  open,
  onOpenChange,
  patient: fixedPatient,
  visitId,
}: AddServicesDialogProps) {
  const t = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const invalidateBilling = useInvalidateBilling();
  const can = usePermission();
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const canPay = can('payments.create');

  const [patient, setPatient] = useState<PatientBrief | null>(fixedPatient ?? null);
  /** Selected service per field-array row, keyed by RHF field id. */
  const [rowServices, setRowServices] = useState<Record<string, ServiceOption | null>>({});
  /**
   * How the sale is paid. One entry is the ordinary case; a cashier splitting a
   * bill across Click and cash adds more. Kept in sync with the running total
   * below so a single-row split always covers the whole sale.
   */
  const [payments, setPayments] = useState<PaymentPart[]>([
    { method: PaymentMethod.CASH, amount: '0' },
  ]);
  /** One key per dialog opening: a retried submission reuses it. */
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  /** Invoice whose receipt is being pushed to the printer, if any. */
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);

  const form = useForm<CreateInvoiceInput>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      patientId: fixedPatient?.id ?? '',
      branchId: activeBranchId ?? '',
      lines: [{ ...EMPTY_LINE }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });

  useEffect(() => {
    if (!open) return;
    setPatient(fixedPatient ?? null);
    setRowServices({});
    setPayments([{ method: PaymentMethod.CASH, amount: '0' }]);
    setIdempotencyKey(crypto.randomUUID());
    form.reset({
      patientId: fixedPatient?.id ?? '',
      branchId: activeBranchId ?? '',
      lines: [{ ...EMPTY_LINE }],
    });
  }, [open, fixedPatient, activeBranchId]);

  // Cash needs an open shift — warn before the server refuses the payment.
  const { data: shift } = useQuery({
    queryKey: ['shifts', 'current', activeBranchId],
    queryFn: async () => (await billingApi.currentShift()).data,
    enabled: open && canPay,
  });
  const cashBlocked =
    canPay && shift === null && payments.some((p) => p.method === PaymentMethod.CASH);

  const mutation = useMutation({
    mutationFn: ({ values, settle }: { values: CreateInvoiceInput; settle: InvoiceSettlement }) =>
      billingApi.quickInvoice({
        patientId: values.patientId,
        branchId: values.branchId,
        visitId,
        lines: values.lines ?? [],
        settle,
        ...(settle === 'PAY_NOW'
          ? {
              payments:
                payments.length === 1
                  ? [{ method: payments[0]!.method, amount: fromTiyin(totalTiyin) }]
                  : payments,
              idempotencyKey,
            }
          : {}),
      }),
    onSuccess: (res) => {
      const { invoice, paid } = res.data;
      invalidateBilling();
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      onOpenChange(false);
      if (paid) {
        setPrintInvoiceId(invoice.id);
        toast.success(t('quick.paidSuccess', { number: invoice.number }), {
          action: {
            label: t('pay.viewReceipt'),
            onClick: () => router.push(`/invoices/${invoice.id}/receipt`),
          },
        });
      } else {
        toast.success(t('quick.debtSuccess', { number: invoice.number }), {
          action: {
            label: t('quick.viewInvoice'),
            onClick: () => router.push(`/invoices/${invoice.id}`),
          },
        });
      }
    },
    onError: errorToast,
  });

  const submit = (settle: InvoiceSettlement) =>
    form.handleSubmit((values) => mutation.mutate({ values, settle }))();

  const watchedLines = form.watch('lines') ?? [];
  const totalTiyin = watchedLines.reduce<bigint>((acc, line) => {
    const lt = lineTotalTiyin(line.quantity, line.unitPrice, line.discount ?? '0');
    return acc + (lt !== null && lt > 0n ? lt : 0n);
  }, 0n);
  const total = formatUZS(fromTiyin(totalTiyin));
  // Only meaningful once the sale is actually split: a single row always covers
  // the whole total, because its amount is filled in at submit time.
  const splitUnbalanced = payments.length > 1 && splitTotalTiyin(payments) !== totalTiyin;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('quick.title')}</DialogTitle>
            <DialogDescription>
              {fixedPatient ? fixedPatient.fullName : t('quick.subtitle')}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
            {fixedPatient ? null : (
              <div className="space-y-2">
                <Label>{t('form.patient')}</Label>
                <PatientCombobox
                  value={patient}
                  onChange={(p) => {
                    setPatient(p);
                    form.setValue('patientId', p?.id ?? '', { shouldValidate: true });
                  }}
                />
                {form.formState.errors.patientId ? (
                  <p className="text-sm text-destructive">{t('form.patientRequired')}</p>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <Label>{t('form.lines')}</Label>
              <div className="space-y-3">
                {fields.map((field, idx) => {
                  const line = watchedLines[idx];
                  const lt = line
                    ? lineTotalTiyin(line.quantity, line.unitPrice, line.discount ?? '0')
                    : null;
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ ...EMPTY_LINE })}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('form.addLine')}
              </Button>
            </div>

            <Separator />

            <div className="flex flex-wrap items-end justify-between gap-4">
              {canPay ? (
                <div className="min-w-64 flex-1">
                  <PaymentSplit
                    total={fromTiyin(totalTiyin)}
                    value={payments}
                    onChange={setPayments}
                    cashBlocked={shift === null}
                  />
                </div>
              ) : (
                <span />
              )}
              <div className="text-right">
                <p className="text-sm text-muted-foreground">{t('form.totalPreview')}</p>
                <p className="text-2xl font-bold tabular-nums">{total}</p>
              </div>
            </div>

            {cashBlocked ? (
              <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
                {t('quick.shiftRequired')}
              </p>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={mutation.isPending}
                onClick={() => void submit('DEBT')}
              >
                <NotebookPen className="mr-2 h-5 w-5" />
                {t('quick.debt')}
              </Button>
              {canPay ? (
                <Button
                  type="button"
                  size="lg"
                  disabled={mutation.isPending || cashBlocked || splitUnbalanced}
                  onClick={() => void submit('PAY_NOW')}
                >
                  <Banknote className="mr-2 h-5 w-5" />
                  {t('quick.payNow')}
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {printInvoiceId ? (
        <ReceiptPrinter invoiceId={printInvoiceId} onPrinted={() => setPrintInvoiceId(null)} />
      ) : null}
    </>
  );
}
