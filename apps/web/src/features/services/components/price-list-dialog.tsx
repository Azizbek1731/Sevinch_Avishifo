'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { sanitizeMoney, servicesApi, type PriceListRow, type ServiceRow } from '../api';
import { useApiErrorToast } from '../hooks';

export interface PriceListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: PriceListRow | null;
}

function moneyOrEmpty(value: string): string {
  const cleaned = sanitizeMoney(value);
  return cleaned === '' ? '' : cleaned;
}

export function PriceListDialog({ open, onOpenChange, list }: PriceListDialogProps) {
  const t = useTranslations('services');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const isEdit = list !== null;

  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [search, setSearch] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});

  const servicesQuery = useQuery({
    queryKey: ['services', 'all'],
    queryFn: () => servicesApi.listAllServices(),
    enabled: open,
  });
  const detailQuery = useQuery({
    queryKey: ['price-lists', list?.id],
    queryFn: () => servicesApi.getPriceList(list!.id),
    enabled: open && isEdit,
  });

  const services = servicesQuery.data?.data ?? [];

  useEffect(() => {
    if (!open) return;
    setSearch('');
    if (list) {
      setName(list.name);
      setIsActive(list.isActive);
    } else {
      setName('');
      setIsActive(true);
      setPrices({});
    }
  }, [open, list]);

  useEffect(() => {
    if (!open || !detailQuery.data) return;
    const next: Record<string, string> = {};
    for (const item of detailQuery.data.data.items) {
      next[item.serviceId] = item.price;
    }
    setPrices(next);
  }, [open, detailQuery.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.name.uz.toLowerCase().includes(q) ||
        (s.name.ru ?? '').toLowerCase().includes(q),
    );
  }, [services, search]);

  const filledCount = Object.values(prices).filter((v) => v !== '').length;

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      const saved = list
        ? await servicesApi.updatePriceList(list.id, { name: trimmed, isActive })
        : await servicesApi.createPriceList({ name: trimmed, isActive });
      const id = saved.data.id;
      const items = services.map((s) => ({
        serviceId: s.id,
        price: prices[s.id] && prices[s.id] !== '' ? prices[s.id]! : null,
      }));
      if (items.length > 0) {
        await servicesApi.setPriceListItems(id, { items });
      }
      return saved.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      toast.success(isEdit ? t('priceLists.updated') : t('priceLists.created'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('priceLists.form.editTitle') : t('priceLists.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="price-list-name">{t('priceLists.form.name')}</Label>
              <Input
                id="price-list-name"
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex items-end justify-between gap-3 rounded-md border p-3 sm:w-48">
              <Label htmlFor="price-list-active">{t('priceLists.form.isActive')}</Label>
              <Switch id="price-list-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{t('priceLists.form.hint')}</p>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
          />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.code')}</TableHead>
                <TableHead>{t('table.name')}</TableHead>
                <TableHead className="text-right">{t('priceLists.form.catalogPrice')}</TableHead>
                <TableHead className="w-40">{t('priceLists.form.listPrice')}</TableHead>
                <TableHead className="text-right">{t('priceLists.form.saving')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s: ServiceRow) => {
                const listed = prices[s.id] ?? '';
                let saving = '—';
                if (s.currentPrice && listed) {
                  try {
                    const gap = toTiyin(s.currentPrice) - toTiyin(listed);
                    saving = gap > 0n ? formatUZS(fromTiyin(gap)) : '—';
                  } catch {
                    saving = '—';
                  }
                }
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="font-medium">{s.name.uz}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.currentPrice ? formatUZS(s.currentPrice) : '—'}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        value={listed}
                        placeholder={t('priceLists.form.listPriceEmpty')}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [s.id]: moneyOrEmpty(e.target.value) }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {saving}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {t('priceLists.form.filled', { count: filledCount })}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="button"
              disabled={
                mutation.isPending ||
                name.trim() === '' ||
                servicesQuery.isLoading ||
                (isEdit && detailQuery.isLoading)
              }
              onClick={() => mutation.mutate()}
            >
              {t('actions.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
