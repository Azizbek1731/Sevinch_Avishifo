'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronsUpDown } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { cn } from '@/lib/utils';
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
import { localizedText } from '@/lib/localized';
import { billingApi, type ServiceOption } from '../api';
import { searchServiceCatalogue } from '../service-catalogue';

export function serviceName(s: ServiceOption, locale: string): string {
  return localizedText(s.name, locale);
}

export interface ServiceComboboxProps {
  /** Currently selected service (display only; source of truth is the form). */
  value: ServiceOption | null;
  onChange: (service: ServiceOption) => void;
  className?: string;
  kind?: 'LAB' | 'CONSULTATION' | 'ULTRASOUND';
  excludeIds?: string[];
  proceduresOnly?: boolean;
  /** Surgery cases are scheduled through the dedicated inpatient workflow. */
  excludeSurgery?: boolean;
  disabled?: boolean;
}

export function ServiceCombobox({
  value,
  onChange,
  className,
  kind,
  excludeIds = [],
  proceduresOnly = false,
  excludeSurgery = false,
  disabled = false,
}: ServiceComboboxProps) {
  const t = useTranslations('common');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setSearch('');
    setOpen(false);
  }, [kind, proceduresOnly, excludeSurgery]);

  const { data } = useQuery({
    queryKey: ['services', 'billing-search', kind, search, { proceduresOnly, excludeSurgery }],
    queryFn: () =>
      searchServiceCatalogue(billingApi.searchServices, search, {
        kind,
        proceduresOnly,
        excludeSurgery,
      }),
    enabled: open && !disabled,
  });

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(value) => {
        if (!disabled) setOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          disabled={disabled}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground')}>
            {value ? serviceName(value, locale) : t('select')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0"
        align="start"
        onWheel={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            disabled={disabled}
            placeholder={t('search')}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t('notFound')}</CommandEmpty>
            <CommandGroup>
              {(data ?? [])
                .filter((s) => !excludeIds.includes(s.id))
                .map((s) => (
                  <CommandItem
                    key={s.id}
                    value={s.id}
                    disabled={disabled}
                    onSelect={() => {
                      if (disabled) return;
                      onChange(s);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value?.id === s.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate">{serviceName(s, locale)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.currentPrice ? formatUZS(s.currentPrice) : s.code}
                      </span>
                    </div>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
