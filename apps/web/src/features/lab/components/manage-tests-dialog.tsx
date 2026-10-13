'use client';

import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  CreateLabTestInput,
  LabValueType,
  ReferenceRangeInput,
} from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { useCreateLabTest, useLabTests, useUpdateLabTest } from '../hooks';
import { localizedName, type UiLocale } from '../lib';
import type { LabTest } from '../types';

/** Flat editor form (essential fields); transformed to the shared schema on submit. */
const numericText = z
  .string()
  .refine((v) => v.trim() === '' || Number.isFinite(Number(v.trim().replace(',', '.'))), {
    message: 'NaN',
  });

const testFormSchema = z.object({
  code: z.string().min(1),
  nameUz: z.string().min(1),
  nameRu: z.string(),
  nameEn: z.string(),
  specimenType: z.string(),
  parameters: z
    .array(
      z.object({
        name: z.string().min(1),
        unit: z.string(),
        low: numericText,
        high: numericText,
        /** Analyte code and value type, carried through untouched from an import. */
        code: z.string().optional(),
        valueType: z.string().optional(),
        /**
         * The parameter's stored intervals. This form edits a single plain low/high pair,
         * which a catalogue analyte does not have — CBC haemoglobin alone carries fourteen
         * age, sex and trimester bands. Those are held here and written back unchanged, so
         * opening this dialog on an imported test can never flatten them.
         */
        ranges: z.array(z.custom<ReferenceRangeInput>()).default([]),
      }),
    )
    .min(1),
});
type TestFormValues = z.infer<typeof testFormSchema>;

/** True when the whole interval set is one plain low/high pair this form can edit. */
function isSimpleRangeSet(ranges: readonly ReferenceRangeInput[]): boolean {
  if (ranges.length === 0) return true;
  if (ranges.length > 1) return false;
  const r = ranges[0]!;
  return (
    r.gender === undefined &&
    r.state === undefined &&
    r.ageMinDays === undefined &&
    r.ageMaxDays === undefined &&
    r.ageMinY === undefined &&
    r.ageMaxY === undefined &&
    r.criticalLow === undefined &&
    r.criticalHigh === undefined &&
    r.textNorm === undefined
  );
}

function toPayload(values: TestFormValues): CreateLabTestInput {
  return {
    code: values.code.trim(),
    name: {
      uz: values.nameUz.trim(),
      ru: values.nameRu.trim() || undefined,
      en: values.nameEn.trim() || undefined,
    },
    specimenType: values.specimenType.trim() || undefined,
    parameters: values.parameters.map((p, idx) => {
      const low = p.low.trim().replace(',', '.');
      const high = p.high.trim().replace(',', '.');
      const simple = isSimpleRangeSet(p.ranges);
      const ranges: ReferenceRangeInput[] = simple
        ? low !== '' && high !== ''
          ? [{ low: Number(low), high: Number(high) }]
          : []
        : p.ranges;
      return {
        name: p.name.trim(),
        code: p.code || undefined,
        unit: p.unit.trim() || undefined,
        valueType: (p.valueType as LabValueType | undefined) ?? undefined,
        referenceRanges: ranges,
        sortOrder: idx,
      };
    }),
  };
}

function toFormValues(test: LabTest): TestFormValues {
  return {
    code: test.code,
    nameUz: test.name.uz,
    nameRu: test.name.ru ?? '',
    nameEn: test.name.en ?? '',
    specimenType: test.specimenType ?? '',
    parameters: test.parameters.map((p) => {
      const simple = isSimpleRangeSet(p.referenceRanges);
      const first = simple ? p.referenceRanges[0] : undefined;
      return {
        name: p.name,
        code: p.code ?? undefined,
        unit: p.unit ?? '',
        valueType: p.valueType,
        low: first?.low !== undefined ? String(first.low) : '',
        high: first?.high !== undefined ? String(first.high) : '',
        ranges: p.referenceRanges,
      };
    }),
  };
}

const EMPTY_FORM: TestFormValues = {
  code: '',
  nameUz: '',
  nameRu: '',
  nameEn: '',
  specimenType: '',
  parameters: [{ name: '', unit: '', low: '', high: '', ranges: [] }],
};

function TestForm({
  editing,
  onBack,
}: {
  editing: LabTest | 'new';
  onBack: () => void;
}) {
  const t = useTranslations('lab');
  const tc = useTranslations('common');

  const form = useForm<TestFormValues>({
    resolver: zodResolver(testFormSchema),
    defaultValues: editing === 'new' ? EMPTY_FORM : toFormValues(editing),
  });
  const paramsArray = useFieldArray({ control: form.control, name: 'parameters' });

  const createTest = useCreateLabTest(onBack);
  const updateTest = useUpdateLabTest(onBack);
  const isPending = createTest.isPending || updateTest.isPending;

  const onSubmit = form.handleSubmit((values) => {
    const payload = toPayload(values);
    if (editing === 'new') createTest.mutate(payload);
    else updateTest.mutate({ id: editing.id, ...payload });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lab-test-code">{t('testCode')}</Label>
          <Input id="lab-test-code" {...form.register('code')} />
          {form.formState.errors.code ? (
            <p className="text-xs font-medium text-destructive">{tc('required')}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-test-specimen">{t('specimenType')}</Label>
          <Input id="lab-test-specimen" {...form.register('specimenType')} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lab-test-name-uz">{t('nameUz')}</Label>
          <Input id="lab-test-name-uz" {...form.register('nameUz')} />
          {form.formState.errors.nameUz ? (
            <p className="text-xs font-medium text-destructive">{tc('required')}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-test-name-ru">{t('nameRu')}</Label>
          <Input id="lab-test-name-ru" {...form.register('nameRu')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lab-test-name-en">{t('nameEn')}</Label>
          <Input id="lab-test-name-en" {...form.register('nameEn')} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('parameters')}</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              paramsArray.append({ name: '', unit: '', low: '', high: '', ranges: [] })
            }
          >
            <Plus className="h-4 w-4" />
            {t('addParameter')}
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_80px_70px_70px_32px] items-center gap-2 px-1 text-xs text-muted-foreground">
          <span>{t('parameterName')}</span>
          <span>{t('unit')}</span>
          <span>{t('refLow')}</span>
          <span>{t('refHigh')}</span>
          <span />
        </div>
        {paramsArray.fields.map((field, idx) => {
          const detailed = !isSimpleRangeSet(field.ranges ?? []);
          return (
          <div key={field.id} className="grid grid-cols-[1fr_80px_70px_70px_32px] items-center gap-2">
            <Input {...form.register(`parameters.${idx}.name`)} />
            <Input {...form.register(`parameters.${idx}.unit`)} />
            {detailed ? (
              <span
                className="col-span-2 truncate rounded-md border border-dashed px-2 py-2 text-center text-xs text-muted-foreground"
                title={t('refDetailedHint')}
              >
                {t('refDetailed', { count: field.ranges.length })}
              </span>
            ) : (
              <>
                <Input inputMode="decimal" {...form.register(`parameters.${idx}.low`)} />
                <Input inputMode="decimal" {...form.register(`parameters.${idx}.high`)} />
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tc('delete')}
              disabled={paramsArray.fields.length <= 1}
              onClick={() => paramsArray.remove(idx)}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          );
        })}
        {form.formState.errors.parameters ? (
          <p className="text-xs font-medium text-destructive">{t('parametersInvalid')}</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          {tc('back')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {tc('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ManageTestsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('lab');
  const tc = useTranslations('common');
  const locale = useLocale() as UiLocale;
  const [editing, setEditing] = useState<LabTest | 'new' | null>(null);

  const testsQuery = useLabTests(undefined, open);

  const handleOpenChange = (next: boolean) => {
    if (!next) setEditing(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing === null
              ? t('manageTestsTitle')
              : editing === 'new'
                ? t('newTest')
                : t('editTest')}
          </DialogTitle>
        </DialogHeader>

        {editing !== null ? (
          <TestForm editing={editing} onBack={() => setEditing(null)} />
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" />
                {t('newTest')}
              </Button>
            </div>
            {/* Constrain the scrolling element itself so every test remains reachable. */}
            <div
              className="max-h-[50dvh] overflow-y-auto overscroll-y-contain rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              role="region"
              aria-label={t('manageTestsTitle')}
              tabIndex={0}
            >
              {testsQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-3/4" />
                </div>
              ) : (testsQuery.data ?? []).length === 0 ? (
                <EmptyState title={t('noTests')} className="border-none" />
              ) : (
                <div className="divide-y">
                  {(testsQuery.data ?? []).map((test) => (
                    <div key={test.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                        {test.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {localizedName(test.name, locale)}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('parameterCount', { count: test.parameters.length })}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tc('edit')}
                        onClick={() => setEditing(test)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
