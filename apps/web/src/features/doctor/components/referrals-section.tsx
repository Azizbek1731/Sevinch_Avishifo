'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronsUpDown, Send } from 'lucide-react';
import { addReferralSchema, ReferralType, type AddReferralInput } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/empty-state';
import type { LabTestItem, VisitReferral } from '../api';
import { useAddReferral, useLabTests } from '../hooks';

function labTestName(test: LabTestItem, locale: string): string {
  return test.name[locale] ?? test.name['uz'] ?? test.code;
}

export function ReferralsSection({
  visitId,
  referrals,
  disabled,
}: {
  visitId: string;
  referrals: VisitReferral[];
  disabled: boolean;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const addReferral = useAddReferral(visitId);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [testsOpen, setTestsOpen] = useState(false);
  const [labError, setLabError] = useState(false);

  const form = useForm<AddReferralInput>({
    resolver: zodResolver(addReferralSchema),
    defaultValues: { type: ReferralType.SPECIALIST, targetSpecialty: '', note: '' },
  });
  const type = form.watch('type');

  const { data: labTests } = useLabTests(type === ReferralType.LAB);

  const toggleTest = (id: string) => {
    setSelectedTests((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setLabError(false);
  };

  const onSubmit = form.handleSubmit((values) => {
    if (values.type === ReferralType.LAB && selectedTests.length === 0) {
      setLabError(true);
      return;
    }
    if (values.type === ReferralType.SPECIALIST && !values.targetSpecialty?.trim()) {
      form.setError('targetSpecialty', { type: 'manual', message: t('specialtyRequired') });
      return;
    }
    addReferral.mutate(
      {
        type: values.type,
        targetSpecialty:
          values.type === ReferralType.SPECIALIST ? values.targetSpecialty?.trim() : undefined,
        labTestIds: values.type === ReferralType.LAB ? selectedTests : undefined,
        note: values.note?.trim() || undefined,
      },
      {
        onSuccess: () => {
          form.reset({ type: ReferralType.SPECIALIST, targetSpecialty: '', note: '' });
          setSelectedTests([]);
        },
      },
    );
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('referrals')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!disabled ? (
          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t('referralType')}</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  form.setValue('type', v as ReferralType);
                  setLabError(false);
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ReferralType.SPECIALIST}>
                    {t('referralTypes.SPECIALIST')}
                  </SelectItem>
                  <SelectItem value={ReferralType.LAB}>{t('referralTypes.LAB')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {type === ReferralType.SPECIALIST ? (
              <div className="min-w-52 space-y-1.5">
                <Label htmlFor="ref-specialty">{t('specialty')}</Label>
                <Input id="ref-specialty" {...form.register('targetSpecialty')} />
                {form.formState.errors.targetSpecialty ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.targetSpecialty.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="min-w-52 space-y-1.5">
                <Label>{t('labTests')}</Label>
                <Popover open={testsOpen} onOpenChange={setTestsOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-56 justify-between font-normal">
                      {selectedTests.length > 0
                        ? t('labTestsSelected', { count: selectedTests.length })
                        : tCommon('select')}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="max-h-72 w-72 overflow-auto p-2" align="start">
                    {(labTests ?? [])
                      .filter((test) => test.isActive)
                      .map((test) => (
                        <label
                          key={test.id}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={selectedTests.includes(test.id)}
                            onCheckedChange={() => toggleTest(test.id)}
                          />
                          <span className="truncate">
                            {labTestName(test, locale)}{' '}
                            <span className="text-muted-foreground">{test.code}</span>
                          </span>
                        </label>
                      ))}
                  </PopoverContent>
                </Popover>
                {labError ? (
                  <p className="text-xs text-destructive">{t('labTestsRequired')}</p>
                ) : null}
              </div>
            )}

            <div className="min-w-44 flex-1 space-y-1.5">
              <Label htmlFor="ref-note">{t('referralNote')}</Label>
              <Input id="ref-note" {...form.register('note')} />
            </div>
            <Button type="submit" disabled={addReferral.isPending}>
              {t('sendReferral')}
            </Button>
          </form>
        ) : null}

        {referrals.length === 0 ? (
          <EmptyState icon={Send} title={t('noReferrals')} className="py-8" />
        ) : (
          <ul className="space-y-2">
            {referrals.map((ref) => (
              <li
                key={ref.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <Badge variant="secondary" className="mr-2">
                      {t(`referralTypes.${ref.type}` as never)}
                    </Badge>
                    {ref.type === ReferralType.SPECIALIST
                      ? (ref.targetSpecialty ?? '—')
                      : t('labOrderCreated')}
                  </p>
                  {ref.note ? (
                    <p className="truncate text-xs text-muted-foreground">{ref.note}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
