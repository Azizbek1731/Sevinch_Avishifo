'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronsUpDown } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
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
import { useAuthStore } from '@/stores/auth-store';
import { localizedText } from '@/lib/localized';
import { servicesApi, type ServiceRow } from '@/features/services/api';

export function SurgeryCataloguePicker({
  kind,
  value,
  onChange,
  disabled = false,
  id,
  invalid = false,
  describedBy,
}: {
  kind: 'SURGERY' | 'MATERIAL' | 'MEDICINE';
  value: ServiceRow | null;
  onChange: (service: ServiceRow) => void;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('surgeries');
  const locale = useLocale();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['services', 'surgery-picker', branchId, kind, search],
    queryFn: async () =>
      (
        await servicesApi.listServices({
          kind,
          search: search.trim() || undefined,
          isActive: true,
          limit: 30,
        })
      ).data,
    enabled: open && !disabled,
  });
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          id={id}
          disabled={disabled}
          aria-expanded={open && !disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {value ? localizedText(value.name, locale) : t('selectCatalogue')}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] max-w-[calc(100vw-2rem)] p-0"
        align="start"
        onWheel={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            disabled={disabled}
            onValueChange={(next) => {
              if (!disabled) setSearch(next);
            }}
            placeholder={t('searchCatalogue')}
          />
          <CommandList>
            <CommandEmpty>
              {t(query.isLoading ? 'loading' : query.isError ? 'loadError' : 'emptyCatalogue')}
            </CommandEmpty>
            <CommandGroup>
              {query.data?.map((service) => (
                <CommandItem
                  key={service.id}
                  value={service.id}
                  disabled={disabled || service.currentPrice === null}
                  onSelect={() => {
                    if (disabled || service.currentPrice === null) return;
                    onChange(service);
                    setOpen(false);
                  }}
                >
                  <div className="w-full space-y-1">
                    <p className="font-medium">{localizedText(service.name, locale)}</p>
                    <p className="text-xs text-muted-foreground">
                      {service.code} ·{' '}
                      {service.currentPrice !== null
                        ? formatUZS(service.currentPrice)
                        : t('unpriced')}{' '}
                      / {service.unit}
                    </p>
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
