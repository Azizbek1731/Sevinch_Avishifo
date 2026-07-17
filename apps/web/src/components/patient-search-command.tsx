'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { formatPhone } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { useRouter } from '@/i18n/routing';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface PatientHit {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

export function PatientSearchCommand({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const [query, setQuery] = useState('');

  // Global hotkey: Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const { data } = useQuery({
    queryKey: ['patients', 'quick-search', query],
    queryFn: async () =>
      (await api.get<PatientHit[]>('/patients', { search: query, limit: 8 })).data,
    enabled: open && query.trim().length >= 2,
  });

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput placeholder={t('search')} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{t('notFound')}</CommandEmpty>
        <CommandGroup heading={t('patient')}>
          {(data ?? []).map((p) => (
            <CommandItem
              key={p.id}
              value={p.id}
              onSelect={() => {
                onOpenChange(false);
                setQuery('');
                router.push(`/patients/${p.id}`);
              }}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate font-medium">{p.fullName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.phone ? formatPhone(p.phone) : p.mrn}
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
