'use client';

import { useState } from 'react';
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
import { billingApi, type ServiceOption } from '../api';

export function serviceName(s: ServiceOption, locale: string): string {
  if (locale === 'ru' && s.name.ru) return s.name.ru;
  if (locale === 'en' && s.name.en) return s.name.en;
  return s.name.uz;
}

export interface ServiceComboboxProps {
  /** Currently selected service (display only; source of truth is the form). */
  value: ServiceOption | null;
  onChange: (service: ServiceOption) => void;
  className?: string;
}

export function ServiceCombobox({ value, onChange, className }: ServiceComboboxProps) {
  const t = useTranslations('common');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['services', 'billing-search', search],
    queryFn: async () => (await billingApi.searchServices(search.trim())).data,
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? serviceName(value, locale) : t('select')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t('search')} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{t('notFound')}</CommandEmpty>
            <CommandGroup>
              {(data ?? []).map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value?.id === s.id ? 'opacity-100' : 'opacity-0')}
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
