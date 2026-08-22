'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { formatPhone } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PatientHit {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Admitting straight from the ward list: reception looks the patient up here and
 * hands off to the same AdmitDialog the patient card uses. Before this existed the
 * ward page was read-only and its empty state just pointed at the patient card —
 * which nobody standing at the reception desk with a patient in front of them found.
 */
export function AdmitPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (patient: { id: string; fullName: string }) => void;
}) {
  const t = useTranslations('admissions');
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const patients = useQuery({
    queryKey: ['admissions', 'patient-search', debounced],
    queryFn: async () =>
      (await api.get<PatientHit[]>('/patients', { search: debounced, limit: 8 })).data,
    enabled: open && debounced.trim().length >= 2,
  });

  const rows = patients.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pickPatientTitle')}</DialogTitle>
          <DialogDescription>{t('pickPatientDescription')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('pickPatientPlaceholder')}
            className="pl-9"
          />
        </div>

        {patients.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length > 0 ? (
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {rows.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onOpenChange(false);
                  onPick({ id: p.id, fullName: p.fullName });
                }}
              >
                <span className="truncate font-medium">{p.fullName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.phone ? formatPhone(p.phone) : p.mrn}
                </span>
              </button>
            ))}
          </div>
        ) : debounced.trim().length >= 2 && patients.isFetched ? (
          <p className="text-sm text-muted-foreground">{t('pickPatientEmpty')}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('pickPatientHint')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
