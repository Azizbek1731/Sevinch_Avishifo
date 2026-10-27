'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, ChevronsUpDown, UserPlus, X } from 'lucide-react';
import { formatPhone } from '@avishifo/shared';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { NewPatientDialog } from '@/features/reception/components/new-patient-dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { billingApi, type PatientBrief } from '../api';

export interface PatientComboboxProps {
  value: PatientBrief | null;
  onChange: (patient: PatientBrief | null) => void;
  /** Show a clear (×) affordance when a patient is selected. */
  clearable?: boolean;
  /** Enable patient registration within a care workflow, subject to permissions. */
  allowCreate?: boolean;
  className?: string;
}

export function PatientCombobox({
  value,
  onChange,
  clearable = false,
  allowCreate = false,
  className,
}: PatientComboboxProps) {
  const t = useTranslations('common');
  const tr = useTranslations('reception');
  const can = usePermissions();
  const canCreate = allowCreate && can('patients.write');
  const [open, setOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['patients', 'billing-search', search],
    queryFn: async () => (await billingApi.searchPatients(search)).data,
    enabled: open && search.trim().length >= 2,
  });

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', !value && 'text-muted-foreground')}>
              {value ? value.fullName : t('select')}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[320px] max-w-[calc(100vw-2rem)] p-0"
          align="start"
          onWheel={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            if (newPatientOpen) event.preventDefault();
          }}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={tr('walkIn.searchPlaceholder')}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {search.trim().length < 2 ? tr('newPatient.searchHint') : t('notFound')}
              </CommandEmpty>
              <CommandGroup>
                {(data ?? []).map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange(p);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value?.id === p.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate">{p.fullName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {p.phone ? formatPhone(p.phone) : p.mrn}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {canCreate ? (
            <div className="border-t p-2">
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start gap-2"
                onClick={() => {
                  setOpen(false);
                  setNewPatientOpen(true);
                }}
              >
                <UserPlus className="h-4 w-4" />
                {tr('newPatient.add')}
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {clearable && value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
      {canCreate ? (
        <NewPatientDialog
          open={newPatientOpen}
          onOpenChange={setNewPatientOpen}
          onCreated={onChange}
          onSelectExisting={onChange}
        />
      ) : null}
    </div>
  );
}
