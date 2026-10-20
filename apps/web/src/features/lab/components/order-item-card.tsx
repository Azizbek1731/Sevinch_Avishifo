'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, FileText, Save } from 'lucide-react';
import { ResultFlag, type PhysiologicalState } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useEnterResults } from '../hooks';
import {
  flagClass,
  flagMark,
  isCriticalFlag,
  localizedName,
  parameterName,
  rangeText,
  referenceText,
  type ReferenceTextLabels,
  type UiLocale,
} from '../lib';
import type { LabOrderItem } from '../types';

export function OrderItemCard({
  item,
  locked,
  canEnter,
  attachments,
}: {
  item: LabOrderItem;
  /** Order left the active pipeline (approved/delivered/cancelled) — inputs disabled. */
  locked: boolean;
  canEnter: boolean;
  attachments: Array<{ id: string; title: string; fileName: string }>;
}) {
  const t = useTranslations('lab');
  const locale = useLocale() as UiLocale;
  const enumLabel = useEnumLabel();
  const refLabels: ReferenceTextLabels = {
    genderLabel: (g) => enumLabel('gender', g),
    stateLabel: (st: PhysiologicalState) => t(`physiologicalState.${st}` as never),
    yearsSuffix: t('ageYearsShort'),
    daysSuffix: t('ageDaysShort'),
    monthsSuffix: t('ageMonthsShort'),
  };
  const enterResults = useEnterResults();

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((item.result?.values ?? []).map((v) => [v.parameterId, v.value])),
  );
  const [note, setNote] = useState(item.result?.note ?? '');
  const [mode, setMode] = useState<'values' | 'file'>(
    item.result?.reportDocumentId ? 'file' : 'values',
  );
  const [reportDocumentId, setReportDocumentId] = useState(item.result?.reportDocumentId ?? '');

  const savedFlags = new Map((item.result?.values ?? []).map((v) => [v.parameterId, v.flag]));
  const editable = !locked && canEnter;
  const criticalNames = item.labTest.parameters
    .filter((p) => {
      const f = savedFlags.get(p.id);
      return f === ResultFlag.CRITICAL_LOW || f === ResultFlag.CRITICAL_HIGH;
    })
    .map((p) => parameterName(p, locale));

  const save = () => {
    if (mode === 'file') {
      if (!reportDocumentId) {
        toast.error(t('fileResultRequired'));
        return;
      }
      enterResults.mutate({ itemId: item.id, values: [], reportDocumentId, note: note.trim() });
      return;
    }
    const entries = Object.entries(values)
      .map(([parameterId, value]) => ({ parameterId, value: value.trim() }))
      .filter((v) => v.value !== '');
    if (entries.length === 0) {
      toast.error(t('valuesRequired'));
      return;
    }
    enterResults.mutate({
      itemId: item.id,
      values: entries,
      note: note.trim(),
      reportDocumentId: null,
    });
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
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'values' ? 'default' : 'outline'}
              onClick={() => setMode('values')}
            >
              {t('manualResult')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'file' ? 'default' : 'outline'}
              onClick={() => setMode('file')}
            >
              <FileText className="h-4 w-4" />
              {t('fileResult')}
            </Button>
          </div>
        ) : null}
        {mode === 'file' ? (
          <div className="space-y-2 rounded-md border p-3">
            <Label>{t('fileResult')}</Label>
            {editable ? (
              <Select value={reportDocumentId || undefined} onValueChange={setReportDocumentId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectReportFile')} />
                </SelectTrigger>
                <SelectContent>
                  {attachments.map((attachment) => (
                    <SelectItem key={attachment.id} value={attachment.id}>
                      {attachment.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm font-medium">{item.result?.reportDocument?.fileName ?? '—'}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('fileResultHint')}</p>
          </div>
        ) : (
          <>
            {criticalNames.length > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p>
                  <span className="font-medium">{t('criticalValueTitle')}</span>{' '}
                  {criticalNames.join(', ')} — {t('criticalValueBody')}
                </p>
              </div>
            ) : null}
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
                    const critical = flag !== undefined && isCriticalFlag(flag);
                    return (
                      <TableRow
                        key={param.id}
                        className={critical ? 'bg-destructive/5' : undefined}
                      >
                        <TableCell className="font-medium">
                          {parameterName(param, locale)}
                        </TableCell>
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
                          {param.matchedRange ? (
                            // The one interval that applies to THIS patient — their age, sex
                            // and trimester — rather than the whole table for them to read past.
                            <span className="text-foreground">
                              {rangeText(param.matchedRange, refLabels)}
                            </span>
                          ) : param.requiresState ? (
                            <span className="text-warning">{t('refNeedsState')}</span>
                          ) : param.referenceMissing ? (
                            <span title={referenceText(param.referenceRanges, refLabels)}>
                              {t('refNotForThisPatient')}
                            </span>
                          ) : (
                            referenceText(param.referenceRanges, refLabels)
                          )}
                        </TableCell>
                        <TableCell>
                          {flag ? (
                            <span
                              className={cn('inline-flex items-center gap-1', flagClass(flag))}
                              title={critical ? t('criticalValueHint') : undefined}
                            >
                              {critical ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
                              {flagMark(flag)}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

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
