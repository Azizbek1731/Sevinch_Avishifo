'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Download, Search } from 'lucide-react';
import { Biomaterial, type Gender, type PhysiologicalState } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { useDebouncedValue, useImportLabCatalog, useLabCatalog, useLabCatalogSummary } from '../hooks';
import { localizedName, referenceText, type UiLocale } from '../lib';
import type { LabCatalogTest } from '../types';

const BIOMATERIALS = Object.values(Biomaterial);

/**
 * Add tests from the standard MoH / WHO catalogue.
 *
 * The catalogue is shared and read-only; importing copies the chosen tests into this
 * clinic's own list, reference intervals included, after which they are the clinic's to
 * edit. Tests already imported stay visible but unticked, so the dialog reads as "what
 * the standard has" rather than "what is left".
 */
export function CatalogImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('lab');
  const locale = useLocale() as UiLocale;
  const [search, setSearch] = useState('');
  const [biomaterial, setBiomaterial] = useState<Biomaterial | null>(null);
  const [onlyNew, setOnlyNew] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const summary = useLabCatalogSummary(open);
  const catalog = useLabCatalog(
    {
      search: debouncedSearch || undefined,
      biomaterial: biomaterial ?? undefined,
      onlyNew: onlyNew || undefined,
      limit: 500,
    },
    open,
  );

  const importMutation = useImportLabCatalog(() => {
    setSelected([]);
    onOpenChange(false);
  });

  const tests = catalog.data?.data ?? [];
  const countByBiomaterial = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of summary.data?.biomaterials ?? []) map.set(row.value, row.count);
    return map;
  }, [summary.data]);

  const rangeLabels = useMemo(
    () => ({
      genderLabel: (g: Gender) => t(`genderLabel.${g}` as never),
      stateLabel: (s: PhysiologicalState) => t(`physiologicalState.${s}` as never),
      yearsSuffix: t('ageYearsShort'),
      daysSuffix: t('ageDaysShort'),
      monthsSuffix: t('ageMonthsShort'),
    }),
    [t],
  );

  const toggle = (code: string): void =>
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );

  const selectableCodes = tests.filter((x) => !x.imported).map((x) => x.code);
  const allSelected = selectableCodes.length > 0 && selectableCodes.every((c) => selected.includes(c));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t('catalogTitle')}</DialogTitle>
          <DialogDescription>
            {summary.data
              ? t('catalogSubtitle', {
                  total: summary.data.total,
                  imported: summary.data.importedCount,
                })
              : t('catalogSubtitleLoading')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('catalogSearchPlaceholder')}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={biomaterial === null}
              onClick={() => setBiomaterial(null)}
              label={t('catalogAll')}
              count={summary.data?.total}
            />
            {BIOMATERIALS.map((b) => {
              const count = countByBiomaterial.get(b);
              if (!count) return null;
              return (
                <FilterChip
                  key={b}
                  active={biomaterial === b}
                  onClick={() => setBiomaterial(biomaterial === b ? null : b)}
                  label={t(`biomaterial.${b}` as never)}
                  count={count}
                />
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={onlyNew} onCheckedChange={(v) => setOnlyNew(v === true)} />
              {t('catalogOnlyNew')}
            </label>
            {selectableCodes.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected((prev) =>
                    allSelected
                      ? prev.filter((c) => !selectableCodes.includes(c))
                      : [...new Set([...prev, ...selectableCodes])],
                  )
                }
              >
                {allSelected ? t('catalogClearAll') : t('catalogSelectAll')}
              </Button>
            ) : null}
          </div>
        </div>

        {/* A plain overflow container, not <ScrollArea>: Radix sizes its viewport with
            height:100%, which resolves to auto when the parent's height comes from flex
            — the viewport then grew to all 130 rows and there was nothing left to
            scroll. A flex item with min-h-0 gets a definite height and scrolls natively. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border">
          {catalog.isPending ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : catalog.isError ? (
            <EmptyState title={t('catalogLoadFailed')} />
          ) : tests.length === 0 ? (
            <EmptyState title={t('catalogEmpty')} />
          ) : (
            <ul className="divide-y">
              {tests.map((test) => (
                <CatalogRow
                  key={test.code}
                  test={test}
                  locale={locale}
                  checked={selected.includes(test.code)}
                  onToggle={() => toggle(test.code)}
                  expanded={expanded === test.code}
                  onExpand={() => setExpanded(expanded === test.code ? null : test.code)}
                  labels={rangeLabels}
                />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {t('selectedCount', { count: selected.length })}
          </span>
          <Button
            type="button"
            disabled={selected.length === 0 || importMutation.isPending}
            onClick={() =>
              importMutation.mutate({ codes: selected, overwriteExisting: false })
            }
          >
            <Download className="h-4 w-4" />
            {t('catalogImport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-8 rounded-full border px-3 text-xs transition-colors ${
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'
      }`}
    >
      {label}
      {count !== undefined ? <span className="ml-1 opacity-70">{count}</span> : null}
    </button>
  );
}

function CatalogRow({
  test,
  locale,
  checked,
  onToggle,
  expanded,
  onExpand,
  labels,
}: {
  test: LabCatalogTest;
  locale: UiLocale;
  checked: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  labels: Parameters<typeof referenceText>[1];
}) {
  const t = useTranslations('lab');
  return (
    <li className="px-3 py-2">
      <div className="flex items-start gap-3">
        {test.imported ? (
          <span
            className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-success/15 text-success"
            title={t('catalogAlreadyImported')}
          >
            <Check className="h-3 w-3" />
          </span>
        ) : (
          <Checkbox className="mt-1" checked={checked} onCheckedChange={onToggle} />
        )}

        <button
          type="button"
          onClick={onExpand}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{localizedName(test.name, locale)}</span>
            <Badge variant="outline" className="text-[10px]">
              {test.code}
            </Badge>
            {test.imported ? (
              <Badge variant="secondary" className="text-[10px]">
                {t('catalogAlreadyImported')}
              </Badge>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {t('parameterCount', { count: test.parameterCount })}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </span>
        </button>
      </div>

      {expanded ? (
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2.5 text-xs">
          {test.specimenNote ? (
            <p className="text-muted-foreground">{test.specimenNote}</p>
          ) : null}
          {test.parameters.map((p) => (
            <div key={p.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{localizedName(p.name, locale)}</span>
              {p.unit ? <span className="text-muted-foreground">{p.unit}</span> : null}
              <span className="text-muted-foreground">
                {referenceText(p.referenceRanges, labels)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}
