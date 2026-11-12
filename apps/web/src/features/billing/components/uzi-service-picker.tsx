'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Search } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  uziServiceMatchesDoctor,
  type DoctorOption,
} from '@/features/clinical-orders/doctor-matching';
import { billingApi, type ServiceOption } from '../api';
import { serviceName } from './service-combobox';

export interface UziServicePickerProps {
  selected: ServiceOption[];
  onChange: (next: ServiceOption[]) => void;
  doctor: DoctorOption | null;
  disabled?: boolean;
  excludeIds?: string[];
}

/**
 * Ultrasound catalogue for one selected doctor — multi-select like the lab picker.
 * Rows are filtered by category / title match to the chosen UZI specialist.
 */
export function UziServicePicker({
  selected,
  onChange,
  doctor,
  disabled = false,
  excludeIds = [],
}: UziServicePickerProps) {
  const t = useTranslations('billing.uziPicker');
  const locale = useLocale();
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['services', 'uzi-picker', doctor?.id ?? 'none'],
    queryFn: () => billingApi.searchServices('', 'ULTRASOUND'),
    enabled: Boolean(doctor),
  });

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds]);

  const catalogue = useMemo(() => {
    if (!doctor) return [];
    return (data?.data ?? []).filter(
      (service) =>
        !excluded.has(service.id) && uziServiceMatchesDoctor(service, doctor, locale),
    );
  }, [data?.data, doctor, excluded, locale]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return catalogue;
    return catalogue.filter((service) => {
      const name = serviceName(service, locale).toLowerCase();
      return name.includes(q) || service.code.toLowerCase().includes(q);
    });
  }, [catalogue, q, locale]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) =>
        serviceName(a, locale).localeCompare(serviceName(b, locale), locale),
      ),
    [filtered, locale],
  );

  const toggle = (service: ServiceOption) => {
    if (disabled || !doctor) return;
    if (selectedIds.has(service.id)) {
      onChange(selected.filter((item) => item.id !== service.id));
      return;
    }
    onChange([...selected, service]);
  };

  if (!doctor) {
    return <p className="text-sm text-muted-foreground">{t('pickDoctorFirst')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search')}
          className="pl-9"
        />
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-primary/20 bg-primary/5 p-2">
          {selected.map((service) => (
            <button
              key={service.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(service)}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
            >
              <span className="truncate">{serviceName(service, locale)}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
      )}

      <div className="max-h-[min(52vh,28rem)] space-y-2 overflow-y-auto rounded-xl border bg-muted/20 p-3">
        <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between bg-muted/95 px-1 py-1 backdrop-blur">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {doctor.fullName}
            {doctor.specialty ? ` · ${doctor.specialty}` : ''}
          </h3>
          <span className="text-xs text-muted-foreground">
            {t('count', { count: sorted.length })}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}
        {isError ? <p className="text-sm text-destructive">{t('loadError')}</p> : null}
        {!isLoading && !isError && sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          {sorted.map((service) => {
            const active = selectedIds.has(service.id);
            return (
              <button
                key={service.id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(service)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'hover:border-primary/40 hover:bg-primary/5',
                  disabled && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30',
                  )}
                >
                  {active ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">
                    {serviceName(service, locale)}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{service.code}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {service.currentPrice ? formatUZS(service.currentPrice) : '—'}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
