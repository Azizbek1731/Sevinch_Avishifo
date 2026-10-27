'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/routing';
import { labApi } from '@/features/lab/api';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import {
  findDoctorConsultationService,
  isUziSpecialty,
} from '@/features/clinical-orders/doctor-matching';
import { ServiceCombobox, serviceName } from '@/features/billing/components/service-combobox';
import { billingApi, type ServiceOption } from '@/features/billing/api';
import { searchServiceCatalogue } from '@/features/billing/service-catalogue';
import { localizedText } from '@/lib/localized';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronsUpDown, Send, Trash2 } from 'lucide-react';
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
  const [uziServices, setUziServices] = useState<ServiceOption[]>([]);
  const [specialistService, setSpecialistService] = useState<ServiceOption | null>(null);
  const [targetDoctorId, setTargetDoctorId] = useState('');
  const [testsOpen, setTestsOpen] = useState(false);
  const [labError, setLabError] = useState(false);
  const [clinicalError, setClinicalError] = useState(false);
  const [testSearch, setTestSearch] = useState('');
  const orders = useQuery({
    queryKey: ['lab-orders', { visitId, includeUnpaid: true }],
    queryFn: () => labApi.listOrders({ visitId, includeUnpaid: true, limit: 100 }),
    select: (response) => response.data,
    refetchInterval: 10_000,
  });
  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors'],
    queryFn: () => clinicalOrdersApi.doctors(),
    select: (response) => response.data,
  });

  const form = useForm<AddReferralInput>({
    resolver: zodResolver(addReferralSchema),
    defaultValues: {
      type: ReferralType.LAB,
      note: '',
      labTestIds: undefined,
      serviceIds: undefined,
      targetDoctorUserId: undefined,
      targetSpecialty: undefined,
    },
  });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onUnsavedChange?.(
      dirty ||
        selectedTests.length > 0 ||
        uziServices.length > 0 ||
        Boolean(specialistService) ||
        Boolean(targetDoctorId) ||
        addReferral.isPending,
    );
  }, [
    dirty,
    selectedTests.length,
    uziServices.length,
    specialistService,
    targetDoctorId,
    addReferral.isPending,
    onUnsavedChange,
  ]);
  const type = form.watch('type');

  const uziDoctors = useMemo(
    () => (doctors.data ?? []).filter((doctor) => isUziSpecialty(doctor.specialty)),
    [doctors.data],
  );
  const specialistDoctors = useMemo(() => doctors.data ?? [], [doctors.data]);

  useEffect(() => {
    form.setValue('labTestIds', selectedTests.length ? selectedTests : undefined, {
      shouldValidate: false,
    });
  }, [selectedTests, form]);

  useEffect(() => {
    if (type === ReferralType.ULTRASOUND) {
      form.setValue(
        'serviceIds',
        uziServices.length ? uziServices.map((service) => service.id) : undefined,
        { shouldValidate: false },
      );
      form.setValue('targetDoctorUserId', targetDoctorId || undefined, { shouldValidate: false });
    } else if (type === ReferralType.SPECIALIST) {
      form.setValue('serviceIds', specialistService ? [specialistService.id] : undefined, {
        shouldValidate: false,
      });
      form.setValue('targetDoctorUserId', targetDoctorId || undefined, { shouldValidate: false });
    } else {
      form.setValue('serviceIds', undefined, { shouldValidate: false });
      form.setValue('targetDoctorUserId', undefined, { shouldValidate: false });
    }
  }, [type, uziServices, specialistService, targetDoctorId, form]);

  const {
    data: labTests,
    isLoading: testsLoading,
    isError: testsError,
  } = useLabTests(type === ReferralType.LAB, testSearch);

  const toggleTest = (id: string) => {
    setSelectedTests((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setLabError(false);
  };

  const resetForm = () => {
    form.reset({
      type: ReferralType.LAB,
      note: '',
      labTestIds: undefined,
      serviceIds: undefined,
      targetDoctorUserId: undefined,
      targetSpecialty: undefined,
    });
    setTestSearch('');
    setTestsOpen(false);
    setSelectedTests([]);
    setUziServices([]);
    setSpecialistService(null);
    setTargetDoctorId('');
    setLabError(false);
    setClinicalError(false);
  };

  const pickSpecialistDoctor = async (doctorId: string) => {
    setTargetDoctorId(doctorId);
    setClinicalError(false);
    const doctor = specialistDoctors.find((item) => item.id === doctorId);
    if (!doctor) {
      setSpecialistService(null);
      form.setValue('targetSpecialty', undefined);
      return;
    }
    form.setValue('targetSpecialty', doctor.specialty ?? doctor.fullName);
    try {
      const catalogue = await searchServiceCatalogue(billingApi.searchServices, doctor.fullName, {
        kind: 'CONSULTATION',
      });
      const match = findDoctorConsultationService(catalogue, doctor, locale);
      setSpecialistService(match ?? null);
      if (!match) toast.error(t('specialistServiceMissing'));
    } catch {
      setSpecialistService(null);
      toast.error(t('specialistServiceMissing'));
    }
  };

  const onSubmit = form.handleSubmit(
    (values) => {
      if (values.type === ReferralType.LAB && selectedTests.length === 0) {
        setLabError(true);
        return;
      }
      if (values.type === ReferralType.ULTRASOUND) {
        if (uziServices.length === 0 || !targetDoctorId) {
          setClinicalError(true);
          return;
        }
      }
      if (values.type === ReferralType.SPECIALIST) {
        if (!specialistService || !targetDoctorId) {
          setClinicalError(true);
          return;
        }
      }
      const doctor = specialistDoctors.find((item) => item.id === targetDoctorId);
      addReferral.mutate(
        {
          type: values.type,
          targetSpecialty:
            values.type === ReferralType.SPECIALIST
              ? (doctor?.specialty ?? doctor?.fullName ?? values.targetSpecialty)?.trim()
              : undefined,
          targetDoctorUserId:
            values.type === ReferralType.ULTRASOUND || values.type === ReferralType.SPECIALIST
              ? targetDoctorId
              : undefined,
          labTestIds: values.type === ReferralType.LAB ? selectedTests : undefined,
          serviceIds:
            values.type === ReferralType.ULTRASOUND
              ? uziServices.map((service) => service.id)
              : values.type === ReferralType.SPECIALIST && specialistService
                ? [specialistService.id]
                : undefined,
          note: values.note?.trim() || undefined,
        },
        { onSuccess: resetForm },
      );
    },
    () => {
      if (type === ReferralType.LAB) setLabError(true);
      if (type === ReferralType.ULTRASOUND || type === ReferralType.SPECIALIST)
        setClinicalError(true);
    },
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{t('referrals')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-lg bg-primary/5 p-3 text-sm text-muted-foreground">
          {t('referralWorkflow')}
        </p>
        {!disabled ? (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>{t('referralType')}</Label>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    const next = v as ReferralType;
                    form.setValue('type', next);
                    form.unregister('targetSpecialty');
                    setTargetDoctorId('');
                    setUziServices([]);
                    setSpecialistService(null);
                    setSelectedTests([]);
                    setLabError(false);
                    setClinicalError(false);
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ReferralType.LAB}>{t('referralTypes.LAB')}</SelectItem>
                    <SelectItem value={ReferralType.ULTRASOUND}>
                      {t('referralTypes.ULTRASOUND')}
                    </SelectItem>
                    <SelectItem value={ReferralType.SPECIALIST}>
                      {t('referralTypes.SPECIALIST')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {type === ReferralType.LAB ? (
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
              ) : null}

              {type === ReferralType.ULTRASOUND ? (
                <div className="min-w-52 space-y-1.5">
                  <Label>{t('uziDoctor')}</Label>
                  <Select
                    value={targetDoctorId || undefined}
                    onValueChange={(value) => {
                      setTargetDoctorId(value);
                      setClinicalError(false);
                    }}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder={tCommon('select')} />
                    </SelectTrigger>
                    <SelectContent>
                      {uziDoctors.map((doctor) => (
                        <SelectItem key={doctor.id} value={doctor.id}>
                          {doctor.fullName}
                          {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!uziDoctors.length ? (
                    <p className="text-xs text-muted-foreground">{t('noUziDoctors')}</p>
                  ) : null}
                </div>
              ) : null}

              {type === ReferralType.SPECIALIST ? (
                <div className="min-w-52 space-y-1.5">
                  <Label>{t('specialistDoctor')}</Label>
                  <Select
                    value={targetDoctorId || undefined}
                    onValueChange={(value) => void pickSpecialistDoctor(value)}
                  >
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder={tCommon('select')} />
                    </SelectTrigger>
                    <SelectContent>
                      {specialistDoctors.map((doctor) => (
                        <SelectItem key={doctor.id} value={doctor.id}>
                          {doctor.fullName}
                          {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {specialistService ? (
                    <p className="text-xs text-muted-foreground">
                      {serviceName(specialistService, locale)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="min-w-44 flex-1 space-y-1.5">
                <Label htmlFor="ref-note">{t('referralNote')}</Label>
                <Input id="ref-note" {...form.register('note')} />
              </div>
              <Button type="submit" disabled={addReferral.isPending}>
                {t('labReferral.sendToCashier')}
              </Button>
            </div>

            {type === ReferralType.ULTRASOUND ? (
              <div className="space-y-2 rounded-lg border p-3">
                <Label>{t('uziServices')}</Label>
                <ServiceCombobox
                  value={null}
                  kind="ULTRASOUND"
                  excludeIds={uziServices.map((service) => service.id)}
                  onChange={(service) => {
                    setUziServices((prev) =>
                      prev.some((item) => item.id === service.id) ? prev : [...prev, service],
                    );
                    setClinicalError(false);
                  }}
                />
                {uziServices.length ? (
                  <ul className="divide-y rounded-md border">
                    {uziServices.map((service) => (
                      <li
                        key={service.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span>{serviceName(service, locale)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={tCommon('delete')}
                          onClick={() =>
                            setUziServices((prev) => prev.filter((item) => item.id !== service.id))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {clinicalError ? (
                  <p className="text-xs text-destructive">{t('uziReferralRequired')}</p>
                ) : null}
              </div>
            ) : null}

            {type === ReferralType.SPECIALIST && clinicalError ? (
              <p className="text-xs text-destructive">{t('specialistReferralRequired')}</p>
            ) : null}
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
                      ? (ref.targetSpecialty ?? t('specialistOrderCreated'))
                      : ref.type === ReferralType.ULTRASOUND
                        ? t('uziOrderCreated')
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
                  {ref.clinicalOrder
                    ? (() => {
                        const order = ref.clinicalOrder;
                        const isUzi = ref.type === ReferralType.ULTRASOUND;
                        return (
                          <div className="mt-2 space-y-2">
                            <p className="text-sm">
                              {order.services
                                .map((service) => localizedText(service.title, locale))
                                .join(', ')}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  order.status === 'COMPLETED'
                                    ? 'default'
                                    : order.status === 'WAITING_PAYMENT'
                                      ? 'outline'
                                      : 'secondary'
                                }
                              >
                                {order.status === 'CANCELLED'
                                  ? t('labReferral.cancelled')
                                  : order.status === 'WAITING_PAYMENT'
                                    ? t('labReferral.waitingPayment')
                                    : order.status === 'READY'
                                      ? isUzi
                                        ? t('uziReferral.ready')
                                        : t('specialistReferral.ready')
                                      : order.status === 'COMPLETED'
                                        ? isUzi
                                          ? t('uziReferral.done')
                                          : t('specialistReferral.done')
                                        : isUzi
                                          ? t('uziReferral.inProgress')
                                          : t('specialistReferral.inProgress')}
                              </Badge>
                              {order.visitId ? (
                                <Button asChild variant="outline" size="sm">
                                  <Link href={`/doctor/visits/${order.visitId}`}>
                                    {isUzi
                                      ? t('uziReferral.openVisit')
                                      : t('specialistReferral.openVisit')}
                                  </Link>
                                </Button>
                              ) : (
                                <Button asChild variant="outline" size="sm">
                                  <Link href={isUzi ? '/uzi' : '/doctor'}>
                                    {isUzi
                                      ? t('uziReferral.openWorklist')
                                      : t('specialistReferral.openWorklist')}
                                  </Link>
                                </Button>
                              )}
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
