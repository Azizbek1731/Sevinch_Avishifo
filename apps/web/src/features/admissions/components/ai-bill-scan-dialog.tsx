'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatUZS, fromTiyin, toTiyin, type MoneyString } from '@avishifo/shared';
import { Sparkles, Trash2, Upload } from 'lucide-react';
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
import { useApiErrorToast } from '@/features/services/hooks';
import { todayTashkent } from '@/lib/dates';
import { chargesApi, type AiBillScanLine } from '../api';

type DraftLine = AiBillScanLine & { key: string };

function createKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeMoney(value: string): string {
  return value.replace(/\s/g, '').replace(/,/g, '').replace(/[^\d.]/g, '');
}

export function AiBillScanDialog({
  open,
  onOpenChange,
  patientId,
  admissionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  admissionId?: string;
}) {
  const t = useTranslations('charges.aiScan');
  const tc = useTranslations('common');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ patientName?: string | null; doctorName?: string | null; notes?: string | null; model?: string }>({});
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [date, setDate] = useState(todayTashkent());

  const status = useQuery({
    queryKey: ['charges', 'ai-scan-status'],
    queryFn: async () => (await chargesApi.aiScanStatus()).data,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setLines([]);
    setMeta({});
    setDate(todayTashkent());
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [open]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const scan = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (await chargesApi.aiScan(form)).data;
    },
    onSuccess: (data) => {
      setMeta({
        patientName: data.patientName,
        doctorName: data.doctorName,
        notes: data.notes,
        model: data.model,
      });
      setLines(
        (data.lines ?? []).map((line) => ({
          ...line,
          key: createKey(),
          unitPrice: line.unitPrice,
          quantity: line.quantity || 1,
        })),
      );
      toast.success(t('scanned', { count: data.lines?.length ?? 0 }));
    },
    onError: errorToast,
  });

  const save = useMutation({
    mutationFn: async () => {
      const items = lines
        .map((line) => {
          const unitPrice = sanitizeMoney(String(line.unitPrice));
          if (!line.title.trim() || !unitPrice) return null;
          return {
            title: line.title.trim(),
            quantity: Math.min(999, Math.max(1, Number(line.quantity) || 1)),
            unitPrice: unitPrice.includes('.') ? Number(unitPrice).toFixed(2) : `${unitPrice}.00`,
            date: line.date || undefined,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      if (!items.length) throw new Error('empty');
      return chargesApi.addBatch({
        patientId,
        admissionId,
        date,
        items,
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['charges', patientId] });
      void queryClient.invalidateQueries({ queryKey: ['admission-discharge-check', admissionId] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(t('saved', { count: res.data.count }));
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'empty') {
        toast.error(t('needLines'));
        return;
      }
      errorToast(error);
    },
  });

  const total = useMemo(
    () =>
      lines.reduce((acc, line) => {
        const price = sanitizeMoney(String(line.unitPrice)) || '0';
        const qty = Math.max(1, Number(line.quantity) || 1);
        try {
          return acc + toTiyin(price as MoneyString) * BigInt(qty);
        } catch {
          return acc;
        }
      }, 0n),
    [lines],
  );

  const enabled = status.data?.enabled !== false;
  const busy = scan.isPending || save.isPending;

  const onPickFile = (file: File | undefined) => {
    if (!file || busy) return;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    scan.mutate(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>

        {!enabled && status.isSuccess ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t('disabled')}
          </p>
        ) : null}

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-bill-date">{t('date')}</Label>
              <Input
                id="ai-bill-date"
                type="date"
                value={date}
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                onPickFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || !enabled}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              {scan.isPending ? t('scanning') : t('upload')}
            </Button>
            {meta.model ? (
              <p className="text-xs text-muted-foreground">{t('model', { model: meta.model })}</p>
            ) : null}
          </div>

          {previewUrl ? (
            <div className="overflow-hidden rounded-lg border bg-muted/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt={t('previewAlt')} className="max-h-56 w-full object-contain" />
            </div>
          ) : null}

          {(meta.patientName || meta.doctorName || meta.notes) && (
            <div className="rounded-md border bg-muted/15 px-3 py-2 text-sm text-muted-foreground">
              {meta.patientName ? <p>{t('patient')}: {meta.patientName}</p> : null}
              {meta.doctorName ? <p>{t('doctor')}: {meta.doctorName}</p> : null}
              {meta.notes ? <p>{t('notes')}: {meta.notes}</p> : null}
            </div>
          )}

          {lines.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t('linesTitle', { count: lines.length })}</p>
                <p className="text-sm font-semibold tabular-nums">
                  {t('total')}: {formatUZS(fromTiyin(total))}
                </p>
              </div>
              <ul className="divide-y rounded-lg border">
                {lines.map((line, index) => (
                  <li key={line.key} className="grid gap-2 p-3 sm:grid-cols-[1fr_5rem_8rem_auto]">
                    <div className="space-y-1">
                      <Label htmlFor={`${titleId}-${index}`}>{t('name')}</Label>
                      <Input
                        id={`${titleId}-${index}`}
                        value={line.title}
                        disabled={busy}
                        onChange={(e) => {
                          const title = e.target.value;
                          setLines((prev) =>
                            prev.map((row) => (row.key === line.key ? { ...row, title } : row)),
                          );
                        }}
                      />
                      {line.note ? <p className="text-xs text-muted-foreground">{line.note}</p> : null}
                    </div>
                    <div className="space-y-1">
                      <Label>{t('qty')}</Label>
                      <Input
                        inputMode="numeric"
                        value={String(line.quantity)}
                        disabled={busy}
                        onChange={(e) => {
                          const quantity = Math.min(999, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1));
                          setLines((prev) =>
                            prev.map((row) => (row.key === line.key ? { ...row, quantity } : row)),
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('price')}</Label>
                      <Input
                        inputMode="decimal"
                        value={String(line.unitPrice)}
                        disabled={busy}
                        onChange={(e) => {
                          const unitPrice = e.target.value;
                          setLines((prev) =>
                            prev.map((row) => (row.key === line.key ? { ...row, unitPrice } : row)),
                          );
                        }}
                      />
                    </div>
                    <div className="flex items-end justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        disabled={busy}
                        aria-label={tc('delete')}
                        onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('editHint')}</p>
            </div>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              {scan.isPending ? t('scanning') : t('empty')}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy || lines.length === 0 || !enabled}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
