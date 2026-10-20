'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { servicesApi, type PriceListDetail } from '@/features/services/api';

const NONE = '__none__';

export interface PriceListSelectProps {
  value: PriceListDetail | null;
  onChange: (list: PriceListDetail | null) => void;
}

export function PriceListSelect({ value, onChange }: PriceListSelectProps) {
  const t = useTranslations('billing');
  const lists = useQuery({
    queryKey: ['price-lists', { isActive: true }],
    queryFn: () => servicesApi.listPriceLists({ isActive: true }),
  });

  return (
    <div className="space-y-2">
      <Label>{t('form.priceList')}</Label>
      <Select
        value={value?.id ?? NONE}
        onValueChange={(id) => {
          if (id === NONE) {
            onChange(null);
            return;
          }
          void servicesApi.getPriceList(id).then((res) => onChange(res.data));
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('form.priceListNone')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('form.priceListNone')}</SelectItem>
          {(lists.data?.data ?? []).map((list) => (
            <SelectItem key={list.id} value={list.id}>
              {list.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t('form.priceListHint')}</p>
    </div>
  );
}
