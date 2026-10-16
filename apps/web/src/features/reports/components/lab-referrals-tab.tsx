'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ReportFilters } from '../api';
import { useLabReferralReport } from '../hooks';
import { ExportButton } from './export-button';

export function LabReferralsTab({ filters }: { filters: ReportFilters }) {
  const t = useTranslations('reports.labReferrals');
  const locale = useLocale();
  const query = useLabReferralReport(filters);
  const report = query.data;
  const metrics = [
    'patients',
    'orders',
    'tests',
    'paidOrders',
    'pendingPaymentOrders',
    'approvedOrders',
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <ExportButton
          path="/reports/lab-referrals"
          filenameBase="lab-referrals"
          filters={filters}
        />
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {metrics.map((key) => (
              <Card key={key}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t(key)}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {report.totals[key].toLocaleString(locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('calculation')}
          </p>
          {report.doctors.length === 0 ? (
            <p className="rounded-lg border p-8 text-center text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="space-y-3">
              {report.doctors.map((doctor) => (
                <details
                  key={doctor.doctorUserId ?? 'direct'}
                  className="rounded-lg border bg-card"
                  open
                >
                  <summary className="cursor-pointer rounded-lg px-4 py-3 font-medium hover:bg-muted/40">
                    {doctor.doctorName ?? t('direct')}
                    <span className="ml-3 text-sm font-normal text-muted-foreground">
                      {t('doctorSummary', {
                        patients: doctor.patients,
                        orders: doctor.orders,
                        tests: doctor.tests,
                      })}
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-left">
                        <tr>
                          <th className="min-w-48 px-4 py-3 font-medium">{t('testName')}</th>
                          {metrics.map((key) => (
                            <th key={key} className="px-3 py-3 text-right font-medium">
                              {t(key)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {doctor.testsBreakdown.map((test) => (
                          <tr key={test.labTestId} className="border-t">
                            <td className="px-4 py-3">
                              <p>{test.name[locale] ?? test.name.uz ?? test.code}</p>
                              <p className="text-xs text-muted-foreground">{test.code}</p>
                            </td>
                            {metrics.map((key) => (
                              <td key={key} className="px-3 py-3 text-right tabular-nums">
                                {test[key]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t bg-muted/30 font-medium">
                        <tr>
                          <td className="px-4 py-3">{t('doctorTotal')}</td>
                          {metrics.map((key) => (
                            <td key={key} className="px-3 py-3 text-right tabular-nums">
                              {doctor[key]}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
