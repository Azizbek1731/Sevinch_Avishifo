'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { labApi } from '@/features/lab/api';
import { localizedText } from '@/lib/localized';
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
  return localizedText(test.name, locale) || test.code;
}

export function ReferralsSection({
  visitId,
  referrals,
  disabled,
  onUnsavedChange,
}: {
  visitId: string;
  referrals: VisitReferral[];
  disabled: boolean;
  onUnsavedChange?: (value: boolean) => void;
}) {
  const t = useTranslations('visits');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const addReferral = useAddReferral(visitId);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [testsOpen, setTestsOpen] = useState(false);
  const [labError, setLabError] = useState(false);
  const [testSearch, setTestSearch] = useState('');
  const orders = useQuery({
    queryKey: ['lab-orders', { visitId, includeUnpaid: true }],
    queryFn: () => labApi.listOrders({ visitId, includeUnpaid: true, limit: 100 }),
    select: (response) => response.data,
    refetchInterval: 10_000,
  });

  const form = useForm<AddReferralInput>({
    resolver: zodResolver(addReferralSchema),
    defaultValues: { type: ReferralType.LAB, note: '' },
  });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onUnsavedChange?.(dirty || selectedTests.length > 0 || addReferral.isPending);
  }, [dirty, selectedTests.length, addReferral.isPending, onUnsavedChange]);
  const type = form.watch('type');

  const {
    data: labTests,
    isLoading: testsLoading,
    isError: testsError,
  } = useLabTests(type === ReferralType.LAB, testSearch);

  const toggleTest = (id: string) => {
    setSelectedTests((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
          form.reset({ type: ReferralType.LAB, note: '' });
          setTestSearch('');
          setTestsOpen(false);
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
        <p className="rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
          {t('labReferral.workflow')}
        </p>
        {!disabled ? (
          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>{t('referralType')}</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  form.setValue('type', v as ReferralType);
                  if (v === ReferralType.LAB) form.unregister('targetSpecialty');
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
                    <Button
                      type="button"
                      variant="outline"
                      disabled={addReferral.isPending}
                      className="w-64 justify-between font-normal"
                    >
                      {selectedTests.length > 0
                        ? t('labTestsSelected', { count: selectedTests.length })
                        : tCommon('select')}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(28rem,90vw)] p-2" align="start">
                    <Input
                      value={testSearch}
                      onChange={(event) => setTestSearch(event.target.value)}
                      placeholder={t('labReferral.search')}
                      className="mb-2"
                    />
                    <div
                      className="max-h-64 overflow-y-auto"
                      onWheel={(event) => event.stopPropagation()}
                    >
                      {testsLoading ? (
                        <p className="p-2 text-sm text-muted-foreground">
                          {t('labReferral.loading')}
                        </p>
                      ) : null}
                      {testsError ? (
                        <p className="p-2 text-sm text-destructive">{t('labReferral.loadError')}</p>
                      ) : null}
                      {!testsLoading && !testsError && labTests?.length === 0 ? (
                        <p className="p-2 text-sm text-muted-foreground">
                          {t('labReferral.noTests')}
                        </p>
                      ) : null}
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
                            <span className="min-w-0 whitespace-normal">
                              {labTestName(test, locale)}{' '}
                              <span className="text-muted-foreground">{test.code}</span>
                            </span>
                          </label>
                        ))}
                    </div>
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
              {type === ReferralType.LAB ? t('labReferral.sendToCashier') : t('sendReferral')}
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
                  {ref.labOrderId
                    ? (() => {
                        const order = orders.data?.find((item) => item.id === ref.labOrderId);
                        return (
                          <div className="mt-2 space-y-2">
                            {order ? (
                              <p className="text-sm">
                                {order.tests
                                  .map((test) => localizedText(test.name, locale) || test.code)
                                  .join(', ')}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                              {order ? (
                                <Badge
                                  variant={
                                    order.status === 'APPROVED' || order.status === 'DELIVERED'
                                      ? 'default'
                                      : 'outline'
                                  }
                                >
                                  {order.status === 'CANCELLED'
                                    ? t('labReferral.cancelled')
                                    : !order.canWork
                                      ? t('labReferral.waitingPayment')
                                      : order.status === 'APPROVED' || order.status === 'DELIVERED'
                                        ? t('labReferral.ready')
                                        : t('labReferral.inLab')}
                                </Badge>
                              ) : null}
                              <Button asChild variant="outline" size="sm">
                                <Link
                                  href={`/lab/${ref.labOrderId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {t('labReferral.openResults')}
                                </Link>
                              </Button>
                            </div>
                          </div>
                        );
                      })()
                    : null}
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
