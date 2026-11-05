'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Search } from 'lucide-react';
import { LabCategory, formatUZS, type LabCategory as LabCategoryType } from '@avishifo/shared';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi, type ServiceOption } from '../api';
import { serviceName } from './service-combobox';

const CATEGORY_ORDER: readonly LabCategoryType[] = [
  LabCategory.BIOCHEMISTRY,
  LabCategory.HEMATOLOGY,
  LabCategory.URINALYSIS,
  LabCategory.COAGULATION,
  LabCategory.HORMONES,
  LabCategory.IMMUNOLOGY,
  LabCategory.TUMOR_MARKERS,
  LabCategory.VITAMINS,
  LabCategory.COPROLOGY,
  LabCategory.ANDROLOGY,
  LabCategory.CYTOLOGY,
  LabCategory.MICROBIOLOGY,
];

const OTHER_KEY = 'OTHER';

function categoryKey(service: ServiceOption): string {
  return service.labCategory && Object.values(LabCategory).includes(service.labCategory as LabCategoryType)
    ? (service.labCategory as string)
    : OTHER_KEY;
}

export interface LabServicePickerProps {
  selected: ServiceOption[];
  onChange: (next: ServiceOption[]) => void;
  disabled?: boolean;
}

/**
 * Reception laboratory catalogue: tests grouped into clinical sections
 * (bioximiya, siydik, …) with multi-select cards.
 */
export function LabServicePicker({ selected, onChange, disabled = false }: LabServicePickerProps) {
  const t = useTranslations('billing.labPicker');
  const tLab = useTranslations('lab');
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('ALL');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['services', 'lab-picker'],
    queryFn: () => billingApi.searchServices('', 'LAB'),
  });

  const services = data?.data ?? [];
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return services.filter((service) => {
      if (!q) return true;
      const name = serviceName(service, locale).toLowerCase();
      return name.includes(q) || service.code.toLowerCase().includes(q);
    });
  }, [services, q, locale]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const service of filtered) {
      const key = categoryKey(service);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [filtered]);

  const visibleCategories = useMemo(() => {
    const keys = [
      ...CATEGORY_ORDER.filter((key) => (counts.get(key) ?? 0) > 0),
      ...((counts.get(OTHER_KEY) ?? 0) > 0 ? [OTHER_KEY] : []),
    ];
    return keys;
  }, [counts]);

  const sections = useMemo(() => {
    const byCategory = new Map<string, ServiceOption[]>();
    for (const service of filtered) {
      const key = categoryKey(service);
      if (activeCategory !== 'ALL' && key !== activeCategory) continue;
      const list = byCategory.get(key) ?? [];
      list.push(service);
      byCategory.set(key, list);
    }
    const order =
      activeCategory === 'ALL'
        ? visibleCategories
        : visibleCategories.filter((key) => key === activeCategory);
    return order.map((key) => ({
      key,
      items: byCategory.get(key) ?? [],
    }));
  }, [filtered, activeCategory, visibleCategories]);

  const categoryLabel = (key: string): string => {
    if (key === OTHER_KEY) return t('other');
    try {
      return tLab(`categories.${key}` as never);
    } catch {
      return key;
    }
  };

  const toggle = (service: ServiceOption) => {
    if (disabled) return;
    if (selectedIds.has(service.id)) {
      onChange(selected.filter((item) => item.id !== service.id));
      return;
    }
    onChange([...selected, service]);
  };

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

      <div className="flex flex-wrap gap-1.5">
        <CategoryChip
          active={activeCategory === 'ALL'}
          label={t('all')}
          count={filtered.length}
          onClick={() => setActiveCategory('ALL')}
          disabled={disabled}
        />
        {visibleCategories.map((key) => (
          <CategoryChip
            key={key}
            active={activeCategory === key}
            label={categoryLabel(key)}
            count={counts.get(key) ?? 0}
            onClick={() => setActiveCategory(key)}
            disabled={disabled}
          />
        ))}
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

      <div className="max-h-[min(52vh,28rem)] space-y-4 overflow-y-auto rounded-xl border bg-muted/20 p-3">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}
        {isError ? <p className="text-sm text-destructive">{t('loadError')}</p> : null}
        {!isLoading && !isError && sections.every((section) => section.items.length === 0) ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : null}
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <section key={section.key} className="space-y-2">
              <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between bg-muted/95 px-1 py-1 backdrop-blur">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {categoryLabel(section.key)}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {t('count', { count: section.items.length })}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {section.items.map((service) => {
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
            </section>
          ),
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  label,
  count,
  onClick,
  disabled,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
          active ? 'bg-primary-foreground/20' : 'bg-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}
