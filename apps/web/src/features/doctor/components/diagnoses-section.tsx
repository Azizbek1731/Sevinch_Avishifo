'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { VisitDetail } from '../api';
import { useAmendVisit, useUpdateVisit } from '../hooks';

/** Free-text ASOSIY / YONDOSH diagnosis — matches the clinic tavsiya sheet. */
export function DiagnosesSection({
  visit,
  disabled,
  onUnsavedChange,
}: {
  visit: VisitDetail;
  disabled: boolean;
  onUnsavedChange?: (value: boolean) => void;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const locked = visit.status === 'COMPLETED';
  const updateVisit = useUpdateVisit(visit.id);
  const amendVisit = useAmendVisit(visit.id);

  const [primary, setPrimary] = useState(visit.diagnosisPrimary ?? '');
  const [secondary, setSecondary] = useState(visit.diagnosisSecondary ?? '');
  const [reason, setReason] = useState('');
  const [savedPrimary, setSavedPrimary] = useState(visit.diagnosisPrimary ?? '');
  const [savedSecondary, setSavedSecondary] = useState(visit.diagnosisSecondary ?? '');

  useEffect(() => {
    setPrimary(visit.diagnosisPrimary ?? '');
    setSecondary(visit.diagnosisSecondary ?? '');
    setSavedPrimary(visit.diagnosisPrimary ?? '');
    setSavedSecondary(visit.diagnosisSecondary ?? '');
  }, [visit.diagnosisPrimary, visit.diagnosisSecondary, visit.id]);

  const dirty = primary !== savedPrimary || secondary !== savedSecondary;
  const pending = updateVisit.isPending || amendVisit.isPending;
  useEffect(() => {
    onUnsavedChange?.(dirty || pending);
  }, [dirty, pending, onUnsavedChange]);

  const persist = (onDone?: () => void) => {
    const body = {
      diagnosisPrimary: primary,
      diagnosisSecondary: secondary,
    };
    if (locked) {
      const trimmed = reason.trim();
      if (trimmed.length < 3) return;
      amendVisit.mutate(
        { ...body, reason: trimmed },
        {
          onSuccess: () => {
            setSavedPrimary(primary);
            setSavedSecondary(secondary);
            setReason('');
            onDone?.();
          },
        },
      );
      return;
    }
    updateVisit.mutate(body, {
      onSuccess: () => {
        setSavedPrimary(primary);
        setSavedSecondary(secondary);
        onDone?.();
      },
    });
  };

  const saveOnBlur = () => {
    if (disabled || locked || !dirty || pending) return;
    persist();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('diagnoses')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('diagnosisFreeHint')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="dx-primary">{t('diagnosisPrimary')}</Label>
          <Textarea
            id="dx-primary"
            rows={3}
            disabled={disabled || pending}
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            onBlur={saveOnBlur}
            placeholder={t('diagnosisPrimaryPlaceholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dx-secondary">{t('diagnosisSecondary')}</Label>
          <Textarea
            id="dx-secondary"
            rows={3}
            disabled={disabled || pending}
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            onBlur={saveOnBlur}
            placeholder={t('diagnosisSecondaryPlaceholder')}
          />
        </div>
        {locked && !disabled ? (
          <div className="space-y-1.5">
            <Label htmlFor="dx-amend-reason">{t('amendReason')}</Label>
            <Textarea
              id="dx-amend-reason"
              rows={2}
              disabled={pending}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}
        {!disabled ? (
          <Button
            type="button"
            disabled={pending || !dirty || (locked && reason.trim().length < 3)}
            onClick={() => persist()}
          >
            {locked ? t('saveAmendment') : tCommon('save')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
