'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { upsertVitalsSchema, type UpsertVitalsInput } from '@avishifo/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { VisitVitals } from '../api';
import { useUpsertVitals } from '../hooks';

const NUMERIC_FIELDS = [
  { name: 'heightCm', unit: 'cm' },
  { name: 'weightKg', unit: 'kg' },
  { name: 'bpSystolic', unit: 'mmHg' },
  { name: 'bpDiastolic', unit: 'mmHg' },
  { name: 'pulseBpm', unit: 'bpm' },
  { name: 'temperatureC', unit: '°C' },
  { name: 'spo2', unit: '%' },
] as const;

type NumericField = (typeof NUMERIC_FIELDS)[number]['name'];

const asOptionalNumber = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

export function VitalsForm({
  visitId,
  vitals,
  disabled,
  onUnsavedChange,
}: {
  visitId: string;
  vitals: VisitVitals | null;
  disabled: boolean;
  onUnsavedChange?: (value: boolean) => void;
}) {
  const t = useTranslations('visits');
  const upsert = useUpsertVitals(visitId);

  const form = useForm<UpsertVitalsInput>({
    resolver: zodResolver(upsertVitalsSchema),
    defaultValues: {
      heightCm: vitals?.heightCm ?? undefined,
      weightKg: vitals?.weightKg ?? undefined,
      bpSystolic: vitals?.bpSystolic ?? undefined,
      bpDiastolic: vitals?.bpDiastolic ?? undefined,
      pulseBpm: vitals?.pulseBpm ?? undefined,
      temperatureC: vitals?.temperatureC ?? undefined,
      spo2: vitals?.spo2 ?? undefined,
      note: vitals?.note ?? undefined,
    },
  });

  const dirty = form.formState.isDirty;
  useEffect(() => {
    onUnsavedChange?.(dirty || upsert.isPending);
  }, [dirty, upsert.isPending, onUnsavedChange]);

  /** Auto-save when leaving a field, but only when something actually changed. */
  const saveOnBlur = () => {
    if (disabled || !form.formState.isDirty) return;
    void form.handleSubmit((values) => {
      upsert.mutate(values, {
        onSuccess: () => form.reset(values),
      });
    })();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('vitals')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onBlur={saveOnBlur} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NUMERIC_FIELDS.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={`vitals-${field.name}`} className="text-xs">
                {t(`vitalsFields.${field.name}` as never)}{' '}
                <span className="text-muted-foreground">({field.unit})</span>
              </Label>
              <Input
                id={`vitals-${field.name}`}
                type="number"
                step="any"
                inputMode="decimal"
                disabled={disabled || upsert.isPending}
                {...form.register(field.name as NumericField, { setValueAs: asOptionalNumber })}
              />
              {form.formState.errors[field.name as NumericField] ? (
                <p className="text-xs text-destructive">{t('vitalsInvalid')}</p>
              ) : null}
            </div>
          ))}
          <div className="col-span-2 space-y-1.5 sm:col-span-4">
            <Label htmlFor="vitals-note" className="text-xs">
              {t('vitalsNote')}
            </Label>
            <Input
              id="vitals-note"
              disabled={disabled || upsert.isPending}
              {...form.register('note', {
                setValueAs: (v: unknown) => (v === '' || v == null ? undefined : String(v)),
              })}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
