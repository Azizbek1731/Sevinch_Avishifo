'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatUZS } from '@avishifo/shared';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function DoctorActivityTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports.doctorActivity');
  const locale = useLocale();
  const query = useDoctorActivityReport(filters);
  const report = query.data;

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        {report ? (
          <p className="text-sm font-medium">
            {t('doctor', { name: report.doctorName })}
          </p>
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

          <section className="space-y-3">
            <h3 className="text-base font-semibold">{t('uziTitle')}</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t('orders')} value={report.ultrasound.orders.toLocaleString(locale)} />
              <Stat label={t('items')} value={report.ultrasound.items.toLocaleString(locale)} />
              <Stat label={t('amount')} value={formatUZS(report.ultrasound.amount)} />
              <Stat
                label={t('paidAmount')}
                value={formatUZS(report.ultrasound.paidAmount)}
                hint={t('unpaidHint', { amount: formatUZS(report.ultrasound.unpaidAmount) })}
              />
            </div>
            <ReferralTable
              empty={t('uziEmpty')}
              lines={report.ultrasoundLines}
              paidLabel={t('paid')}
              unpaidLabel={t('unpaid')}
              columns={{
                date: t('colDate'),
                patient: t('colPatient'),
                title: t('colUzi'),
                amount: t('colAmount'),
                status: t('colStatus'),
              }}
            />
          </section>

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

function ReferralTable({
  lines,
  empty,
  paidLabel,
  unpaidLabel,
  columns,
}: {
  lines: Array<{
    id: string;
    date: string;
    patientName: string;
    patientMrn: string;
    title: string;
    amount: string;
    paid: boolean;
  }>;
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
