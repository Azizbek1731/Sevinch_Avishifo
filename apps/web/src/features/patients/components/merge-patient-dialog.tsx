'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Search } from 'lucide-react';
import { formatPhone } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { patientsApi, type Patient, type PatientCard } from '../api';
import { useApiErrorToast } from '../hooks';

export interface MergePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The surviving (primary) patient — records of the selected duplicate are moved into it. */
  primary: PatientCard;
}

export function MergePatientDialog({ open, onOpenChange, primary }: MergePatientDialogProps) {
  const t = useTranslations('patients');
  const queryClient = useQueryClient();
  const toastError = useApiErrorToast();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Patient | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelected(null);
    }
  }, [open]);

  const results = useQuery({
    queryKey: ['patients', 'merge-search', debounced],
    queryFn: () => patientsApi.list({ page: 1, limit: 8, search: debounced }),
    enabled: open && debounced.length >= 2,
  });

  const mergeMutation = useMutation({
    mutationFn: (duplicateId: string) =>
      patientsApi.merge({ primaryId: primary.id, duplicateId }),
    onSuccess: () => {
      toast.success(t('merge.merged'));
      void queryClient.invalidateQueries({ queryKey: ['patients'] });
      void queryClient.invalidateQueries({ queryKey: ['visits'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
    },
    onError: toastError,
  });

  const candidates = (results.data?.data ?? []).filter((p) => p.id !== primary.id);

  return (
    <Dialog open={open} onOpenChange={(o) => !mergeMutation.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('merge.title')}</DialogTitle>
          <DialogDescription>
            {t('merge.description', { name: primary.fullName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('merge.searchPlaceholder')}
              className="pl-8"
            />
          </div>

          {results.isLoading && debounced.length >= 2 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}

          {candidates.length > 0 ? (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {candidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent',
                    selected?.id === p.id && 'border-primary bg-accent',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.fullName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.mrn}
                      {p.phone ? ` · ${formatPhone(p.phone)}` : ''}
                    </span>
                  </span>
                  {selected?.id === p.id ? <Badge>{t('merge.selected')}</Badge> : null}
                </button>
              ))}
            </div>
          ) : null}

          {selected ? (
            <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('merge.warning')}
              </p>
              <p className="text-muted-foreground">
                {t('merge.summary', { duplicate: selected.fullName, primary: primary.fullName })}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mergeMutation.isPending}
          >
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!selected || mergeMutation.isPending}
            onClick={() => selected && mergeMutation.mutate(selected.id)}
          >
            {t('merge.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
