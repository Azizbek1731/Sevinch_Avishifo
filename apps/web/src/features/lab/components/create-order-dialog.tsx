'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { createLabOrderSchema, type CreateLabOrderInput } from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { PatientCombobox } from '@/features/billing/components/patient-combobox';
import { useCreateLabOrder, useLabTests } from '../hooks';
import { localizedName, type UiLocale } from '../lib';
import type { PatientHit } from '../types';

export function CreateOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('lab');
  const tc = useTranslations('common');
  const locale = useLocale() as UiLocale;
  const branchId = useAuthStore((s) => s.activeBranchId);

  const [selectedPatient, setSelectedPatient] = useState<PatientHit | null>(null);
  const [testQuery, setTestQuery] = useState('');

  const form = useForm<CreateLabOrderInput>({
    resolver: zodResolver(createLabOrderSchema),
    defaultValues: { patientId: '', branchId: branchId ?? '', testIds: [] },
  });
  const testIds = form.watch('testIds');

  useEffect(() => {
    if (open) {
      form.reset({ patientId: '', branchId: branchId ?? '', testIds: [] });
      setSelectedPatient(null);
      setTestQuery('');
    }
  }, [open, branchId, form]);

  const testsQuery = useLabTests(undefined, open);
  const filteredTests = (testsQuery.data ?? []).filter((test) => {
    if (!testQuery.trim()) return true;
    const q = testQuery.trim().toLowerCase();
    return (
      test.code.toLowerCase().includes(q) ||
      localizedName(test.name, locale).toLowerCase().includes(q) ||
      test.name.uz.toLowerCase().includes(q) ||
      (test.name.ru ?? '').toLowerCase().includes(q) ||
      (test.name.en ?? '').toLowerCase().includes(q)
    );
  });

  const createOrder = useCreateLabOrder(() => onOpenChange(false));

  const toggleTest = (id: string) => {
    const next = testIds.includes(id) ? testIds.filter((x) => x !== id) : [...testIds, id];
    form.setValue('testIds', next, { shouldValidate: form.formState.isSubmitted });
  };

  const onSubmit = form.handleSubmit((values) => createOrder.mutate(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('createOrderTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>{tc('patient')}</Label>
            <PatientCombobox
              value={selectedPatient}
              allowCreate
              clearable
              onChange={(patient) => {
                setSelectedPatient(patient);
                form.setValue('patientId', patient?.id ?? '', {
                  shouldValidate: form.formState.isSubmitted,
                });
              }}
            />
            {form.formState.errors.patientId ? (
              <p className="text-sm font-medium text-destructive">{t('patientRequired')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>
              {t('tests')}
              {testIds.length > 0 ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t('selectedCount', { count: testIds.length })}
                </span>
              ) : null}
            </Label>
            <Input
              placeholder={t('testsSearchPlaceholder')}
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
            />
            <ScrollArea className="h-48 rounded-md border">
              {testsQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              ) : filteredTests.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">{tc('notFound')}</p>
              ) : (
                <div className="p-1">
                  {filteredTests.map((test) => (
                    <label
                      key={test.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={testIds.includes(test.id)}
                        onCheckedChange={() => toggleTest(test.id)}
                      />
                      <span className="font-mono text-xs text-muted-foreground">{test.code}</span>
                      <span className="truncate">{localizedName(test.name, locale)}</span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
            {form.formState.errors.testIds ? (
              <p className="text-sm font-medium text-destructive">{t('testsRequired')}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={createOrder.isPending}>
              {tc('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
