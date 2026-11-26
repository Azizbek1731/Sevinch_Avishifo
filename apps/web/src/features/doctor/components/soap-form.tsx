'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { updateVisitSchema, type UpdateVisitInput } from '@avishifo/shared';
import { ClinicalRichEditor } from '@/components/clinical-rich-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatTz, tashkentToUtcIso } from '@/lib/dates';
import type { VisitDetail } from '../api';
import {
  useAmendVisit,
  useCreateTemplate,
  useSilentUpdateVisit,
  useUpdateVisit,
  useVisitTemplates,
} from '../hooks';
import { clearVisitDraft, useVisitAutosave } from '../use-visit-autosave';

const soapFormSchema = updateVisitSchema.omit({ nextVisitAt: true }).extend({
  reason: z.string().optional(),
});
type SoapFormValues = z.infer<typeof soapFormSchema>;

const SOAP_FIELDS = ['subjective', 'objective', 'assessmentNote', 'plan'] as const;
type SoapField = (typeof SOAP_FIELDS)[number];

type SoapDraft = {
  subjective: string;
  objective: string;
  assessmentNote: string;
  plan: string;
  nextVisitDate: string;
};

export function SoapForm({
  visit,
  locked,
  onUnsavedChange,
}: {
  visit: VisitDetail;
  locked: boolean;
  onUnsavedChange?: (value: boolean) => void;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const updateVisit = useUpdateVisit(visit.id);
  const silentUpdate = useSilentUpdateVisit(visit.id);
  const amendVisit = useAmendVisit(visit.id);
  const { data: templates } = useVisitTemplates();
  const createTemplate = useCreateTemplate();

  const [nextVisitDate, setNextVisitDate] = useState<string>(
    visit.nextVisitAt ? formatTz(visit.nextVisitAt, 'yyyy-MM-dd') : '',
  );
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const form = useForm<SoapFormValues>({
    resolver: zodResolver(soapFormSchema),
    defaultValues: {
      subjective: visit.subjective ?? '',
      objective: visit.objective ?? '',
      assessmentNote: visit.assessmentNote ?? '',
      plan: visit.plan ?? '',
      reason: '',
    },
  });

  const [savedNextVisitDate, setSavedNextVisitDate] = useState(nextVisitDate);
  const watched = form.watch();
  const dirty = form.formState.isDirty || nextVisitDate !== savedNextVisitDate;
  useEffect(() => {
    onUnsavedChange?.(dirty || updateVisit.isPending || amendVisit.isPending || silentUpdate.isPending);
  }, [dirty, updateVisit.isPending, amendVisit.isPending, silentUpdate.isPending, onUnsavedChange]);

  const baselineKey = useMemo(
    () =>
      JSON.stringify({
        subjective: visit.subjective ?? '',
        objective: visit.objective ?? '',
        assessmentNote: visit.assessmentNote ?? '',
        plan: visit.plan ?? '',
        nextVisitDate: visit.nextVisitAt ? formatTz(visit.nextVisitAt, 'yyyy-MM-dd') : '',
      }),
    [visit.subjective, visit.objective, visit.assessmentNote, visit.plan, visit.nextVisitAt],
  );

  const getSnapshot = useCallback((): SoapDraft => {
    const values = form.getValues();
    return {
      subjective: values.subjective ?? '',
      objective: values.objective ?? '',
      assessmentNote: values.assessmentNote ?? '',
      plan: values.plan ?? '',
      nextVisitDate,
    };
  }, [form, nextVisitDate]);

  const buildPayload = useCallback(
    (draft: SoapDraft): UpdateVisitInput => ({
      subjective: draft.subjective,
      objective: draft.objective,
      assessmentNote: draft.assessmentNote,
      plan: draft.plan,
      ...(draft.nextVisitDate ? { nextVisitAt: tashkentToUtcIso(draft.nextVisitDate, '09:00') } : {}),
    }),
    [],
  );

  const { clearDraft } = useVisitAutosave<SoapDraft>({
    visitId: visit.id,
    scope: 'soap',
    baselineKey,
    getSnapshot,
    watchKey: JSON.stringify({
      subjective: watched.subjective,
      objective: watched.objective,
      assessmentNote: watched.assessmentNote,
      plan: watched.plan,
      nextVisitDate,
    }),
    isDirty: dirty,
    enabled: !locked,
    onRestore: (data) => {
      form.setValue('subjective', data.subjective ?? '', { shouldDirty: true });
      form.setValue('objective', data.objective ?? '', { shouldDirty: true });
      form.setValue('assessmentNote', data.assessmentNote ?? '', { shouldDirty: true });
      form.setValue('plan', data.plan ?? '', { shouldDirty: true });
      if (data.nextVisitDate !== undefined) setNextVisitDate(data.nextVisitDate);
    },
    onPersistServer: (data) => {
      if (locked || silentUpdate.isPending || updateVisit.isPending) return;
      const payload = buildPayload(data);
      silentUpdate.mutate(payload, {
        onSuccess: () => {
          const still = getSnapshot();
          if (JSON.stringify(still) !== JSON.stringify(data)) return;
          form.reset({
            subjective: data.subjective,
            objective: data.objective,
            assessmentNote: data.assessmentNote,
            plan: data.plan,
            reason: '',
          });
          setSavedNextVisitDate(data.nextVisitDate);
          clearVisitDraft(visit.id, 'soap');
        },
      });
    },
  });

  const applyTemplate = (templateId: string) => {
    const template = templates?.find((tpl) => tpl.id === templateId);
    if (!template) return;
    for (const field of ['subjective', 'objective', 'plan'] as const) {
      const current = form.getValues(field);
      const fill = template.content[field];
      if ((!current || current.trim() === '') && fill) {
        form.setValue(field, fill, { shouldDirty: true });
      }
    }
  };

  const onSubmit = form.handleSubmit((values) => {
    const soap: UpdateVisitInput = {
      subjective: values.subjective ?? '',
      objective: values.objective ?? '',
      assessmentNote: values.assessmentNote ?? '',
      plan: values.plan ?? '',
      ...(nextVisitDate ? { nextVisitAt: tashkentToUtcIso(nextVisitDate, '09:00') } : {}),
    };
    if (locked) {
      const reason = values.reason?.trim() ?? '';
      if (reason.length < 3) {
        form.setError('reason', { type: 'manual', message: t('amendReasonRequired') });
        return;
      }
      amendVisit.mutate(
        { ...soap, reason },
        {
          onSuccess: () => {
            form.reset({ ...values, reason: '' });
            setSavedNextVisitDate(nextVisitDate);
            clearDraft();
          },
        },
      );
    } else {
      updateVisit.mutate(soap, {
        onSuccess: () => {
          form.reset(values);
          setSavedNextVisitDate(nextVisitDate);
          clearDraft();
        },
      });
    }
  });

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    createTemplate.mutate(
      {
        name,
        content: {
          subjective: form.getValues('subjective') || undefined,
          objective: form.getValues('objective') || undefined,
          plan: form.getValues('plan') || undefined,
        },
      },
      {
        onSuccess: () => {
          setTemplateDialogOpen(false);
          setTemplateName('');
        },
      },
    );
  };

  const pending = updateVisit.isPending || amendVisit.isPending;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-lg">{t('soap')}</CardTitle>
        <div className="flex items-center gap-2">
          <Select onValueChange={applyTemplate}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('templatePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {(templates ?? []).map((tpl) => (
                <SelectItem key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTemplateDialogOpen(true)}
          >
            {t('saveAsTemplate')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {SOAP_FIELDS.map((field: SoapField) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`soap-${field}`}>{t(`soapFields.${field}` as never)}</Label>
              <Controller
                control={form.control}
                name={field}
                render={({ field: f }) => (
                  <ClinicalRichEditor
                    value={f.value ?? ''}
                    onChange={f.onChange}
                    disabled={pending}
                    minHeightClass="min-h-[120px]"
                  />
                )}
              />
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="next-visit">{t('nextVisit')}</Label>
              <Input
                id="next-visit"
                type="date"
                className="w-44"
                value={nextVisitDate}
                onChange={(e) => setNextVisitDate(e.target.value)}
              />
            </div>
            {locked ? (
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="amend-reason">{t('amendReason')}</Label>
                <Input id="amend-reason" {...form.register('reason')} />
                {form.formState.errors.reason ? (
                  <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>
                ) : null}
              </div>
            ) : null}
            <Button type="submit" disabled={pending}>
              {locked ? t('saveAmendment') : tCommon('save')}
            </Button>
          </div>
        </form>
      </CardContent>

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('saveAsTemplate')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="template-name">{t('templateName')}</Label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={saveTemplate}
              disabled={createTemplate.isPending || templateName.trim() === ''}
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
