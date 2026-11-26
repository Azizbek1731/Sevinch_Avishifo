'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { formatUZS, type DoctorActivityMoneyCounts, type DoctorActivityReferralLine } from '@avishifo/shared';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import type { ReportFilters } from '../api';
import { useDoctorActivityReport } from '../hooks';

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card/80 px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DoctorActivityTab({
  filters,
  pickDoctor = false,
}: {
  filters: ReportFilters;
  /** Clinic analytics: choose any doctor (Mohira, Sherzod, …). */
  pickDoctor?: boolean;
}) {
  const t = useTranslations('reports.doctorActivity');
  const locale = useLocale();
  const selfId = useAuthStore((s) => s.user?.id);
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [doctorUserId, setDoctorUserId] = useState<string>(selfId ?? '');

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: pickDoctor && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });
  const doctorOptions = useMemo(() => doctors.data ?? [], [doctors.data]);

  useEffect(() => {
    if (!pickDoctor || doctorUserId || !doctorOptions.length) return;
    const uzi = doctorOptions.find((doctor) => isUziSpecialty(doctor.specialty));
    setDoctorUserId(uzi?.id ?? doctorOptions[0]!.id);
  }, [pickDoctor, doctorUserId, doctorOptions]);

  const selectedId = pickDoctor ? doctorUserId || undefined : undefined;
  const query = useDoctorActivityReport(
    filters,
    selectedId,
    pickDoctor ? Boolean(selectedId) : true,
  );
  const report = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          {report ? (
            <p className="text-sm font-medium">
              {t('doctor', { name: report.doctorName })}
            </p>
          ) : null}
        </div>
        {pickDoctor ? (
          <Select
            value={selectedId || undefined}
            onValueChange={setDoctorUserId}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder={t('pickDoctor')} />
            </SelectTrigger>
            <SelectContent>
              {doctorOptions.map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.fullName}
                  {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 p-4">
          <p>{t('loadError')}</p>
          <Button variant="outline" className="mt-3" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : report ? (
        <>
          <section className="space-y-3">
            <h3 className="text-base font-semibold">{t('visitsTitle')}</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t('visitsTotal')} value={report.visits.total.toLocaleString(locale)} />
              <Stat
                label={t('visitsCompleted')}
                value={report.visits.completed.toLocaleString(locale)}
              />
              <Stat
                label={t('visitsInProgress')}
                value={report.visits.inProgress.toLocaleString(locale)}
              />
              <Stat
                label={t('visitsPatients')}
                value={report.visits.patients.toLocaleString(locale)}
              />
            </div>
          </section>

          {report.compensation.rules.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-base font-semibold">{t('payTitle')}</h3>
              <p className="text-sm text-muted-foreground">
                {report.compensation.rules
                  .map((rule) => t('payRule', { percent: rule.percent, label: rule.label }))
                  .join(' · ')}
              </p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label={t('payPercent')}
                  value={
                    report.compensation.percent === null
                      ? '—'
                      : `${report.compensation.percent}%`
                  }
                />
                <Stat
                  label={t('payBasis')}
                  value={formatUZS(report.compensation.paidBasis)}
                />
                <Stat
                  label={t('payEarnings')}
                  value={formatUZS(report.compensation.earnings)}
                />
                <Stat
                  label={t('payPending')}
                  value={formatUZS(report.compensation.pendingEarnings)}
                  hint={t('payPendingHint', {
                    amount: formatUZS(report.compensation.pendingBasis),
                  })}
                />
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-base font-semibold">{t('labTitle')}</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t('orders')} value={report.lab.orders.toLocaleString(locale)} />
              <Stat label={t('items')} value={report.lab.items.toLocaleString(locale)} />
              <Stat label={t('amount')} value={formatUZS(report.lab.amount)} />
              <Stat
                label={t('paidAmount')}
                value={formatUZS(report.lab.paidAmount)}
                hint={t('unpaidHint', { amount: formatUZS(report.lab.unpaidAmount) })}
              />
            </div>
            <ReferralTable
              empty={t('labEmpty')}
              lines={report.labLines}
              paidLabel={t('paid')}
              unpaidLabel={t('unpaid')}
              columns={{
                date: t('colDate'),
                patient: t('colPatient'),
                title: t('colLab'),
                amount: t('colAmount'),
                status: t('colStatus'),
              }}
            />
          </section>

          <MoneyBlock
            title={t('uziTitle')}
            empty={t('uziEmpty')}
            titleCol={t('colUzi')}
            counts={report.ultrasound}
            lines={report.ultrasoundLines}
            t={t}
            locale={locale}
          />
          <MoneyBlock
            title={t('echoTitle')}
            empty={t('echoEmpty')}
            titleCol={t('colEcho')}
            counts={report.echo}
            lines={report.echoLines}
            t={t}
            locale={locale}
          />
          <MoneyBlock
            title={t('performedUziTitle')}
            empty={t('performedUziEmpty')}
            titleCol={t('colUzi')}
            counts={report.performedUltrasound}
            lines={report.performedUltrasoundLines}
            patientsLabel={t('patients')}
            t={t}
            locale={locale}
          />
          <MoneyBlock
            title={t('performedEchoTitle')}
            empty={t('performedEchoEmpty')}
            titleCol={t('colEcho')}
            counts={report.performedEcho}
            lines={report.performedEchoLines}
            patientsLabel={t('patients')}
            t={t}
            locale={locale}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('visitsListTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {report.visitLines.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">{t('visitsEmpty')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t('colDate')}</th>
                      <th className="px-4 py-3 font-medium">{t('colPatient')}</th>
                      <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.visitLines.map((line) => (
                      <tr key={line.id} className="border-t">
                        <td className="px-4 py-2 tabular-nums">{line.date}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium">{line.patientName}</div>
                          <div className="text-xs text-muted-foreground">{line.patientMrn}</div>
                        </td>
                        <td className="px-4 py-2">
                          {line.status === 'COMPLETED'
                            ? t('statusCompleted')
                            : line.status === 'IN_PROGRESS'
                              ? t('statusInProgress')
                              : t('statusCancelled')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function MoneyBlock({
  title,
  empty,
  titleCol,
  counts,
  lines,
  patientsLabel,
  t,
  locale,
}: {
  title: string;
  empty: string;
  titleCol: string;
  counts: DoctorActivityMoneyCounts;
  lines: DoctorActivityReferralLine[];
  patientsLabel?: string;
  t: ReturnType<typeof useTranslations<'reports.doctorActivity'>>;
  locale: string;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {patientsLabel ? (
          <Stat label={patientsLabel} value={counts.patients.toLocaleString(locale)} />
        ) : null}
        <Stat label={t('orders')} value={counts.orders.toLocaleString(locale)} />
        <Stat label={t('items')} value={counts.items.toLocaleString(locale)} />
        <Stat label={t('amount')} value={formatUZS(counts.amount)} />
        {!patientsLabel ? (
          <Stat
            label={t('paidAmount')}
            value={formatUZS(counts.paidAmount)}
            hint={t('unpaidHint', { amount: formatUZS(counts.unpaidAmount) })}
          />
        ) : (
          <Stat
            label={t('paidAmount')}
            value={formatUZS(counts.paidAmount)}
            hint={t('unpaidHint', { amount: formatUZS(counts.unpaidAmount) })}
          />
        )}
      </div>
      <ReferralTable
        empty={empty}
        lines={lines}
        paidLabel={t('paid')}
        unpaidLabel={t('unpaid')}
        columns={{
          date: t('colDate'),
          patient: t('colPatient'),
          title: titleCol,
          amount: t('colAmount'),
          status: t('colStatus'),
        }}
      />
    </section>
  );
}

function ReferralTable({
  lines,
  empty,
  paidLabel,
  unpaidLabel,
  columns,
}: {
  lines: DoctorActivityReferralLine[];
  empty: string;
  paidLabel: string;
  unpaidLabel: string;
  columns: {
    date: string;
    patient: string;
    title: string;
    amount: string;
    status: string;
  };
}) {
  if (!lines.length) {
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left">
          <tr>
            <th className="px-4 py-3 font-medium">{columns.date}</th>
            <th className="px-4 py-3 font-medium">{columns.patient}</th>
            <th className="min-w-48 px-4 py-3 font-medium">{columns.title}</th>
            <th className="px-4 py-3 text-right font-medium">{columns.amount}</th>
            <th className="px-4 py-3 font-medium">{columns.status}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t">
              <td className="px-4 py-2 tabular-nums">{line.date}</td>
              <td className="px-4 py-2">
                <div className="font-medium">{line.patientName}</div>
                <div className="text-xs text-muted-foreground">{line.patientMrn}</div>
              </td>
              <td className="px-4 py-2">{line.title}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatUZS(line.amount)}</td>
              <td className="px-4 py-2">{line.paid ? paidLabel : unpaidLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
