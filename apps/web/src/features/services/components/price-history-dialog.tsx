'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatUZS, setServicePriceSchema, type SetServicePriceInput } from '@avishifo/shared';
import { formatDate, tashkentToUtcIso, todayTashkent } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { sanitizeMoney, servicesApi, type ServiceRow } from '../api';
import { useApiErrorToast, useCanWriteServices } from '../hooks';

const CLINIC_DEFAULT = 'CLINIC_DEFAULT';

export interface PriceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: ServiceRow | null;
}

export function PriceHistoryDialog({ open, onOpenChange, service }: PriceHistoryDialogProps) {
  const t = useTranslations('services');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useCanWriteServices();
  const branches = useAuthStore((s) => s.branches);

  const [branchSel, setBranchSel] = useState<string>(CLINIC_DEFAULT);
  const [dateStr, setDateStr] = useState<string>(todayTashkent());

  const serviceId = service?.id ?? '';

  const { data, isLoading } = useQuery({
    queryKey: ['service-prices', serviceId],
    queryFn: () => servicesApi.listPriceHistory(serviceId),
    enabled: open && serviceId !== '',
  });
  const rows = data?.data ?? [];

  const form = useForm<SetServicePriceInput>({
    resolver: zodResolver(setServicePriceSchema),
    defaultValues: {
      serviceId: '',
      price: '',
      branchId: undefined,
      effectiveFrom: tashkentToUtcIso(todayTashkent(), '00:00'),
    },
  });

  useEffect(() => {
    if (!open || !service) return;
    const today = todayTashkent();
    setBranchSel(CLINIC_DEFAULT);
    setDateStr(today);
    form.reset({
      serviceId: service.id,
      price: '',
      branchId: undefined,
      effectiveFrom: tashkentToUtcIso(today, '00:00'),
    });
  }, [open, service]);

  const mutation = useMutation({
    mutationFn: (values: SetServicePriceInput) => servicesApi.setPrice(values.serviceId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-prices', serviceId] });
      void queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success(t('prices.added'));
      form.setValue('price', '');
    },
    onError: errorToast,
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));

  const branchName = (branchId: string | null): string => {
    if (branchId === null) return t('prices.clinicDefault');
    return branches.find((b) => b.id === branchId)?.name ?? branchId;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('prices.title', { name: service?.name.uz ?? '' })}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('prices.price')}</TableHead>
                <TableHead>{t('prices.branch')}</TableHead>
                <TableHead>{t('prices.effectiveFrom')}</TableHead>
                <TableHead>{t('prices.effectiveTo')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                    {t('prices.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{formatUZS(row.price)}</TableCell>
                    <TableCell>{branchName(row.branchId)}</TableCell>
                    <TableCell>{formatDate(row.effectiveFrom)}</TableCell>
                    <TableCell>
                      {row.effectiveTo ? formatDate(row.effectiveTo) : t('prices.openEnded')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {canWrite ? (
          <>
            <Separator />
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <p className="text-sm font-semibold">{t('prices.newPrice')}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="new-price">{t('prices.price')}</Label>
                  <Input
                    id="new-price"
                    inputMode="decimal"
                    autoComplete="off"
                    {...form.register('price', { setValueAs: sanitizeMoney })}
                  />
                  {form.formState.errors.price ? (
                    <p className="text-sm text-destructive">{t('form.invalidPrice')}</p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label>{t('prices.branch')}</Label>
                  <Select
                    value={branchSel}
                    onValueChange={(v) => {
                      setBranchSel(v);
                      form.setValue('branchId', v === CLINIC_DEFAULT ? undefined : v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CLINIC_DEFAULT}>{t('prices.clinicDefault')}</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-price-date">{t('prices.effectiveFrom')}</Label>
                  <Input
                    id="new-price-date"
                    type="date"
                    value={dateStr}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDateStr(v);
                      if (v) form.setValue('effectiveFrom', tashkentToUtcIso(v, '00:00'));
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={mutation.isPending}>
                  {t('prices.add')}
                </Button>
              </div>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
