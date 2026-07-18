'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useEnterResults } from '../hooks';
import {
  flagClass,
  flagMark,
  localizedName,
  referenceText,
  type ReferenceTextLabels,
  type UiLocale,
} from '../lib';
import type { LabOrderItem } from '../types';

export function OrderItemCard({
  item,
  locked,
  canEnter,
}: {
  item: LabOrderItem;
  /** Order left the active pipeline (approved/delivered/cancelled) — inputs disabled. */
  locked: boolean;
  canEnter: boolean;
}) {
  const t = useTranslations('lab');
  const locale = useLocale() as UiLocale;
  const enumLabel = useEnumLabel();
  const refLabels: ReferenceTextLabels = {
    genderLabel: (g) => enumLabel('gender', g),
    yearsSuffix: t('refYears'),
  };
  const enterResults = useEnterResults();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((item.result?.values ?? []).map((v) => [v.parameterId, v.value])),
  );
  const [note, setNote] = useState(item.result?.note ?? '');

  const savedFlags = new Map((item.result?.values ?? []).map((v) => [v.parameterId, v.flag]));
  const editable = !locked && canEnter;

  const save = () => {
    const entries = Object.entries(values)
      .map(([parameterId, value]) => ({ parameterId, value: value.trim() }))
      .filter((v) => v.value !== '');
    if (entries.length === 0) {
      toast.error(t('valuesRequired'));
      return;
    }
    enterResults.mutate({ itemId: item.id, values: entries, note: note.trim() || undefined });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline gap-2 text-base">
          <span className="font-mono text-xs text-muted-foreground">{item.labTest.code}</span>
          {localizedName(item.labTest.name, locale)}
          {item.labTest.specimenType ? (
            <span className="text-xs font-normal text-muted-foreground">
              {item.labTest.specimenType}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('parameterName')}</TableHead>
                <TableHead className="w-40">{t('value')}</TableHead>
                <TableHead className="w-20">{t('unit')}</TableHead>
                <TableHead>{t('reference')}</TableHead>
                <TableHead className="w-16">{t('flag')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {item.labTest.parameters.map((param) => {
                const flag = savedFlags.get(param.id);
                return (
                  <TableRow key={param.id}>
                    <TableCell className="font-medium">{param.name}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        value={values[param.id] ?? ''}
                        disabled={!editable}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [param.id]: e.target.value }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {param.unit ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {referenceText(param.referenceRanges, refLabels)}
                    </TableCell>
                    <TableCell>
                      {flag ? (
                        <span className={cn('font-bold', flagClass(flag))}>{flagMark(flag)}</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <Textarea
          placeholder={t('notePlaceholder')}
          value={note}
          disabled={!editable}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />

        {editable ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={enterResults.isPending}>
              <Save className="h-4 w-4" />
              {t('saveResults')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
