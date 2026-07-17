'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { updateVisitSchema, type UpdateVisitInput } from '@avishifo/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { formatTz, tashkentToUtcIso } from '@/lib/dates';
import type { VisitDetail } from '../api';
import { useAmendVisit, useCreateTemplate, useUpdateVisit, useVisitTemplates } from '../hooks';

const soapFormSchema = updateVisitSchema.omit({ nextVisitAt: true }).extend({
  reason: z.string().optional(),
});
type SoapFormValues = z.infer<typeof soapFormSchema>;

const SOAP_FIELDS = ['subjective', 'objective', 'assessmentNote', 'plan'] as const;
type SoapField = (typeof SOAP_FIELDS)[number];

export function SoapForm({ visit, locked }: { visit: VisitDetail; locked: boolean }) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const updateVisit = useUpdateVisit(visit.id);
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
      amendVisit.mutate({ ...soap, reason });
    } else {
      updateVisit.mutate(soap);
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
              <Textarea
                id={`soap-${field}`}
                rows={3}
                {...form.register(field)}
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
                  <p className="text-xs text-destructive">
                    {form.formState.errors.reason.message}
                  </p>
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
