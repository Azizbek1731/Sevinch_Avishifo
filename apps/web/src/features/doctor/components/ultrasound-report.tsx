'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Eye, FileText, Save } from 'lucide-react';
import { updateVisitSchema, type UpdateVisitInput } from '@avishifo/shared';
import { ClinicalHtmlView } from '@/components/clinical-html-view';
import { ClinicalRichEditor } from '@/components/clinical-rich-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stripClinicalHtml } from '@/lib/clinical-html';
import type { VisitDetail } from '../api';
import { useSilentUpdateVisit, useUpdateVisit } from '../hooks';
import { clearVisitDraft, useVisitAutosave } from '../use-visit-autosave';

type UziDraft = {
  reportTitle: string;
  reportBody: string;
};

export function UltrasoundReport({
  visit,
  disabled,
  onUnsavedChange,
}: {
  visit: VisitDetail;
  disabled: boolean;
  onUnsavedChange: (value: boolean) => void;
}) {
  const t = useTranslations('doctor.clinical');
  const [preview, setPreview] = useState(disabled);
  const save = useUpdateVisit(visit.id);
  const silentSave = useSilentUpdateVisit(visit.id);
  const form = useForm<UpdateVisitInput>({
    resolver: zodResolver(updateVisitSchema),
    defaultValues: {
      reportTitle: visit.reportTitle ?? t('ultrasoundReport'),
      reportBody: visit.reportBody ?? '',
    },
  });
  const title = form.watch('reportTitle') ?? '';
  const body = form.watch('reportBody') ?? '';
  const plainLen = stripClinicalHtml(body).length;
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onUnsavedChange(dirty || save.isPending || silentSave.isPending);
  }, [dirty, save.isPending, silentSave.isPending, onUnsavedChange]);

  const baselineKey = useMemo(
    () =>
      JSON.stringify({
        reportTitle: visit.reportTitle ?? t('ultrasoundReport'),
        reportBody: visit.reportBody ?? '',
      }),
    [visit.reportTitle, visit.reportBody, t],
  );

  const getSnapshot = useCallback((): UziDraft => {
    const values = form.getValues();
    return {
      reportTitle: values.reportTitle ?? '',
      reportBody: values.reportBody ?? '',
    };
  }, [form]);

  const { clearDraft } = useVisitAutosave<UziDraft>({
    visitId: visit.id,
    scope: 'uzi',
    baselineKey,
    getSnapshot,
    watchKey: JSON.stringify({ title, body }),
    isDirty: dirty,
    enabled: !disabled,
    onRestore: (data) => {
      form.setValue('reportTitle', data.reportTitle ?? '', { shouldDirty: true });
      form.setValue('reportBody', data.reportBody ?? '', { shouldDirty: true });
    },
    onPersistServer: (data) => {
      if (disabled || silentSave.isPending || save.isPending) return;
      silentSave.mutate(data, {
        onSuccess: () => {
          const still = getSnapshot();
          if (JSON.stringify(still) !== JSON.stringify(data)) return;
          form.reset(data);
          clearVisitDraft(visit.id, 'uzi');
        },
      });
    },
  });

  const submit = form.handleSubmit((values) =>
    save.mutate(values, {
      onSuccess: () => {
        form.reset(values);
        clearDraft();
      },
    }),
  );
  return (
    <form onSubmit={submit} className="rounded-xl border bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card p-4">
        <div>
          <h2 className="font-semibold">{t('ultrasoundReport')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('reportHint')}</p>
        </div>
        <div className="flex items-center gap-2">
          {!disabled ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setPreview(!preview)}>
              {preview ? <FileText className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
              {t(preview ? 'edit' : 'preview')}
            </Button>
          ) : null}
          {!disabled ? (
            <Button type="submit" size="sm" disabled={save.isPending || !dirty}>
              <Save className="mr-2 h-4 w-4" />
              {t('saveDraft')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="p-3 sm:p-6">
        <div className="mx-auto min-h-[700px] max-w-[794px] rounded-sm border bg-white p-5 text-slate-900 shadow-sm sm:p-10">
          <div className="mb-6 border-b pb-4">
            <p className="font-semibold">{visit.patient.fullName}</p>
            <p className="text-sm text-slate-500">
              {visit.patient.mrn} · {visit.doctor.fullName}
            </p>
          </div>
          {preview || disabled ? (
            <>
              <h3 className="mb-6 text-center text-xl font-bold">{title}</h3>
              {plainLen ? (
                <ClinicalHtmlView
                  value={body}
                  className="font-serif text-[16px] leading-7 text-slate-900"
                />
              ) : (
                <p className="font-serif text-[16px] leading-7 text-slate-400">
                  {t('reportPlaceholder')}
                </p>
              )}
            </>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="uzi-title">{t('reportTitle')}</Label>
                <Input
                  id="uzi-title"
                  maxLength={200}
                  disabled={save.isPending}
                  className="bg-white text-lg font-semibold text-slate-900"
                  {...form.register('reportTitle')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('reportBody')}</Label>
                <Controller
                  control={form.control}
                  name="reportBody"
                  render={({ field }) => (
                    <ClinicalRichEditor
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      disabled={save.isPending}
                      placeholder={t('reportPlaceholder')}
                      minHeightClass="min-h-[480px]"
                      className="border-slate-200 bg-white font-serif text-base text-slate-900"
                    />
                  )}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      {Object.keys(form.formState.errors).length ? (
        <p role="alert" className="px-6 pb-3 text-sm text-destructive">
          {t('reportInvalid')}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
        <span>{t(dirty ? 'unsaved' : 'saved')}</span>
        <span>{t('characters', { count: plainLen })}</span>
      </div>
    </form>
  );
}
