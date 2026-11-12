'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiErrorToast } from '@/features/services/hooks';
import { ambulatoryApi } from '../api';

const validPercent = (value: string) => {
  const n = Number(value.replace(',', '.'));
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
};

/** Default share for every doctor plus optional per-doctor overrides. */
export function RatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('ambulatory.rates');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const [defaultPercent, setDefaultPercent] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['ambulatory', 'rates'],
    enabled: open,
    queryFn: async () => (await ambulatoryApi.rates()).data,
  });

  useEffect(() => {
    if (!open || !query.data) return;
    setDefaultPercent(String(query.data.defaultPercent));
    setOverrides(
      Object.fromEntries(
        query.data.doctors.map((doctor) => [
          doctor.doctorUserId,
          doctor.percent === null ? '' : String(doctor.percent),
        ]),
      ),
    );
  }, [open, query.data]);

  const invalid =
    !validPercent(defaultPercent) ||
    Object.values(overrides).some((value) => value.trim() !== '' && !validPercent(value));

  const save = useMutation({
    mutationFn: () =>
      ambulatoryApi.saveRates({
        defaultPercent: Number(defaultPercent.replace(',', '.')),
        doctors: Object.entries(overrides).map(([doctorUserId, value]) => ({
          doctorUserId,
          percent: value.trim() === '' ? null : Number(value.replace(',', '.')),
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      toast.success(t('saved'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5 rounded-lg border bg-muted/25 p-3">
              <Label htmlFor="amb-default-percent">{t('default')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="amb-default-percent"
                  inputMode="decimal"
                  className="w-28"
                  value={defaultPercent}
                  aria-invalid={!validPercent(defaultPercent)}
                  onChange={(event) => setDefaultPercent(event.target.value)}
                />
                <span className="text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('defaultHelp')}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('perDoctor')}</p>
              <div className="divide-y rounded-lg border">
                {(query.data?.doctors ?? []).map((doctor) => {
                  const value = overrides[doctor.doctorUserId] ?? '';
                  return (
                    <div
                      key={doctor.doctorUserId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{doctor.fullName}</p>
                        {doctor.specialty ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {doctor.specialty}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          inputMode="decimal"
                          className="w-24"
                          placeholder={defaultPercent || '—'}
                          value={value}
                          aria-invalid={value.trim() !== '' && !validPercent(value)}
                          onChange={(event) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [doctor.doctorUserId]: event.target.value,
                            }))
                          }
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{t('perDoctorHelp')}</p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            className="w-full"
            disabled={invalid || save.isPending || query.isLoading}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
