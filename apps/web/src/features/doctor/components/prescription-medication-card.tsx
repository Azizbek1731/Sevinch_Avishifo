'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDrugSearch } from '../hooks';
import type { PrescriptionDraftItem } from '../prescription-draft';

export function PrescriptionMedicationCard({
  item,
  index,
  number,
  showDrip,
  disabled,
  onChange,
  onCombine,
  onRemove,
  invalid,
}: {
  item: PrescriptionDraftItem;
  index: number;
  number: number;
  showDrip: boolean;
  disabled: boolean;
  onChange: (patch: Partial<PrescriptionDraftItem>) => void;
  onCombine: (combined: boolean) => void;
  onRemove: () => void;
  invalid: boolean;
}) {
  const t = useTranslations('visits');
  const tc = useTranslations('common');
  const id = useId();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const { data: drugs, isFetching } = useDrugSearch(
    suggestionsOpen && item.drugName.trim().length >= 2 ? item.drugName : '',
  );
  const combined = index > 0 && item.combineWithPrevious;
  const options = (key: string): string[] => {
    const value: unknown = t.raw(`rx.options.${key}`);
    return Array.isArray(value)
      ? value.filter((option): option is string => typeof option === 'string')
      : [];
  };
  const textField = (
    field:
      | 'strength'
      | 'form'
      | 'quantity'
      | 'dosage'
      | 'route'
      | 'frequency'
      | 'durationText'
      | 'instructions'
      | 'dripRate',
    label: string,
    choices?: string[],
    maxLength: number | null = 100,
  ) => {
    const value =
      field === 'durationText' && !item.durationText && item.durationDays
        ? t('days', { count: item.durationDays })
        : item[field];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${field}`}>{label}</Label>
        <Input
          id={`${id}-${field}`}
          value={value}
          maxLength={maxLength ?? undefined}
          autoComplete="off"
          list={choices ? `${id}-${field}-list` : undefined}
          onChange={(event) =>
            onChange({
              [field]: event.target.value,
              ...(field === 'durationText' ? { durationDays: undefined } : {}),
            })
          }
        />
        {choices ? (
          <datalist id={`${id}-${field}-list`}>
            {choices.map((choice) => (
              <option key={choice} value={choice} />
            ))}
          </datalist>
        ) : null}
      </div>
    );
  };
  return (
    <section
      className={`rounded-xl border p-4 ${combined ? 'ml-3 border-l-4 border-l-primary bg-primary/5 sm:ml-8' : 'bg-muted/20'}`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          {combined ? '+' : number}
        </span>
        <h3 className="flex-1 text-sm font-semibold">
          {t(combined ? 'rx.ingredient' : 'rx.medication')}
        </h3>
        {index > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={combined}
              disabled={disabled}
              onCheckedChange={(checked) => onCombine(checked === true)}
            />
            {t('rx.combine')}
          </label>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t('rx.removeMedication')}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      <div
        className={`grid gap-3 ${combined ? 'sm:grid-cols-[2fr_1fr]' : 'sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]'}`}
      >
        <div
          className="relative space-y-1.5"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSuggestionsOpen(false);
          }}
        >
          <Label htmlFor={`${id}-drug`}>{t('drug')} *</Label>
          <Input
            id={`${id}-drug`}
            value={item.drugName}
            autoComplete="off"
            placeholder={t('drugPlaceholder')}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              onChange({ drugName: event.target.value, drugId: undefined });
              setSuggestionsOpen(true);
            }}
            onFocus={() => setSuggestionsOpen(true)}
          />
          {!disabled &&
          suggestionsOpen &&
          item.drugName.trim().length >= 2 &&
          (drugs?.length || isFetching) ? (
            <ul className="absolute z-30 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
              {isFetching ? (
                <li className="p-2 text-xs text-muted-foreground">{tc('loading')}</li>
              ) : (
                (drugs ?? []).map((drug) => (
                  <li key={drug.id}>
                    <button
                      type="button"
                      className="w-full rounded px-2 py-2 text-left text-sm hover:bg-accent focus:bg-accent"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onChange({
                          drugName: drug.name,
                          drugId: drug.id,
                          strength: drug.strength ?? '',
                          form: combined ? '' : (drug.form ?? ''),
                        });
                        setSuggestionsOpen(false);
                      }}
                    >
                      <span className="font-medium">{drug.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {[drug.strength, drug.form].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
          {invalid ? <p className="text-xs text-destructive">{t('drugRequired')}</p> : null}
        </div>
        {textField('strength', t('rx.strength'))}
        {!combined ? textField('form', t('rx.form'), options('forms')) : null}
      </div>
      {!combined ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {textField('quantity', t('rx.quantity'))}
            {textField('dosage', t('dosage'), undefined, null)}
            {textField('route', t('rx.route'), options('routes'))}
            {textField('frequency', t('frequency'), options('frequencies'), null)}
          </div>
          <div
            className={`mt-3 grid gap-3 ${showDrip ? 'sm:grid-cols-3' : 'sm:grid-cols-[1fr_2fr]'}`}
          >
            {textField('durationText', t('rx.duration'), options('durations'), 200)}
            {showDrip ? (
              <div>
                {textField('dripRate', t('rx.dripRate'))}
                <p className="mt-1 text-xs text-muted-foreground">{t('rx.dripUnit')}</p>
              </div>
            ) : null}
            {textField('instructions', t('instructions'), options('instructions'), null)}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{t('rx.ingredientHint')}</p>
      )}
    </section>
  );
}
