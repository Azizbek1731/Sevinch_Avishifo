'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronsUpDown, Stethoscope, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import type { Icd10Item, VisitDiagnosis } from '../api';
import { useAddDiagnosis, useIcd10Search, useRemoveDiagnosis } from '../hooks';

function icd10Name(item: { nameUz: string; nameRu: string | null; nameEn: string | null }, locale: string): string {
  if (locale === 'ru' && item.nameRu) return item.nameRu;
  if (locale === 'en' && item.nameEn) return item.nameEn;
  return item.nameUz;
}

export function DiagnosesSection({
  visitId,
  diagnoses,
  disabled,
}: {
  visitId: string;
  diagnoses: VisitDiagnosis[];
  disabled: boolean;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Icd10Item | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [note, setNote] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: results, isFetching } = useIcd10Search(open ? search : '');
  const addDiagnosis = useAddDiagnosis(visitId);
  const removeDiagnosis = useRemoveDiagnosis(visitId);

  const submit = () => {
    if (!selected) return;
    addDiagnosis.mutate(
      { icd10Id: selected.id, isPrimary, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setSelected(null);
          setSearch('');
          setIsPrimary(false);
          setNote('');
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('diagnoses')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!disabled ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label>{t('icd10Search')}</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">
                      {selected
                        ? `${selected.code} — ${icd10Name(selected, locale)}`
                        : t('icd10Placeholder')}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={t('icd10Placeholder')}
                      value={search}
                      onValueChange={setSearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {isFetching ? tCommon('loading') : tCommon('notFound')}
                      </CommandEmpty>
                      <CommandGroup>
                        {(results ?? []).map((item) => (
                          <CommandItem
                            key={item.id}
                            value={item.id}
                            onSelect={() => {
                              setSelected(item);
                              setOpen(false);
                            }}
                          >
                            <span className="mr-2 font-mono font-semibold">{item.code}</span>
                            <span className="truncate">{icd10Name(item, locale)}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dx-note">{t('diagnosisNote')}</Label>
              <Input
                id="dx-note"
                className="w-48"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex h-9 items-center gap-2">
              <Switch id="dx-primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
              <Label htmlFor="dx-primary">{t('primary')}</Label>
            </div>
            <Button onClick={submit} disabled={!selected || addDiagnosis.isPending}>
              {tCommon('add')}
            </Button>
          </div>
        ) : null}

        {diagnoses.length === 0 ? (
          <EmptyState icon={Stethoscope} title={t('noDiagnoses')} className="py-8" />
        ) : (
          <ul className="space-y-2">
            {diagnoses.map((dx) => (
              <li
                key={dx.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    <span className="font-mono">{dx.icd10.code}</span> —{' '}
                    {icd10Name(dx.icd10, locale)}
                    {dx.isPrimary ? (
                      <Badge className="ml-2" variant="default">
                        {t('primary')}
                      </Badge>
                    ) : null}
                  </p>
                  {dx.note ? (
                    <p className="truncate text-xs text-muted-foreground">{dx.note}</p>
                  ) : null}
                </div>
                {!disabled ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tCommon('delete')}
                    onClick={() => setDeleteId(dx.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
        title={tCommon('confirmDeleteTitle')}
        description={tCommon('confirmDeleteDesc')}
        confirmLabel={tCommon('delete')}
        cancelLabel={tCommon('cancel')}
        destructive
        onConfirm={() => {
          if (deleteId) removeDiagnosis.mutate(deleteId);
          setDeleteId(null);
        }}
      />
    </Card>
  );
}
