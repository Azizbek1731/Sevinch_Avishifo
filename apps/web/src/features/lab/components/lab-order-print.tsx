'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, FlaskConical, Printer } from 'lucide-react';
import { formatPhone } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatDate, formatTz } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { useLabPrintPayload } from '../hooks';
import {
  flagClass,
  flagMark,
  localizedName,
  referenceText,
  type ReferenceTextLabels,
  type UiLocale,
} from '../lib';

export function LabOrderPrint({ id }: { id: string }) {
  const t = useTranslations('lab');
  const tc = useTranslations('common');
  const locale = useLocale() as UiLocale;
  const enumLabel = useEnumLabel();
  const refLabels: ReferenceTextLabels = {
    genderLabel: (g) => enumLabel('gender', g),
    yearsSuffix: t('refYears'),
  };
  const printQuery = useLabPrintPayload(id);

  if (printQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const payload = printQuery.data;
  if (!payload) {
    return (
      <EmptyState
        icon={FlaskConical}
        title={t('orderNotFound')}
        action={
          <Button variant="outline" asChild>
            <Link href="/lab">
              <ArrowLeft className="h-4 w-4" />
              {tc('back')}
            </Link>
          </Button>
        }
      />
    );
  }

  const { clinic, order, approvedBy } = payload;
  const savedValues = new Map(
    order.items.flatMap((it) => (it.result?.values ?? []).map((v) => [v.parameterId, v] as const)),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" asChild>
          <Link href={`/lab/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            {tc('back')}
          </Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          {tc('print')}
        </Button>
      </div>

      <div className="print-area space-y-6 rounded-lg border bg-card p-8 text-sm print:rounded-none print:border-none print:p-0">
        {/* Letterhead */}
        <div className="flex items-start justify-between border-b pb-4">
          <div>
            <p className="text-xl font-bold">{clinic.name}</p>
            {clinic.address ? <p className="text-muted-foreground">{clinic.address}</p> : null}
            {clinic.phone ? (
              <p className="text-muted-foreground">{formatPhone(clinic.phone)}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{t('printFormTitle')}</p>
            <p className="font-mono">{order.orderNumber}</p>
            {order.createdAt ? (
              <p className="text-muted-foreground">{formatTz(order.createdAt)}</p>
            ) : null}
          </div>
        </div>

        {/* Patient */}
        <div className="flex flex-wrap gap-x-10 gap-y-1">
          <p>
            <span className="text-muted-foreground">{tc('patient')}: </span>
            <span className="font-semibold">{order.patient.fullName}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{t('mrn')}: </span>
            <span className="font-mono">{order.patient.mrn}</span>
          </p>
          {order.patient.dob ? (
            <p>
              <span className="text-muted-foreground">{t('dob')}: </span>
              {formatDate(order.patient.dob)}
            </p>
          ) : null}
          {order.patient.gender ? (
            <p>
              <span className="text-muted-foreground">{t('gender')}: </span>
              {t(`genderLabel.${order.patient.gender}` as never)}
            </p>
          ) : null}
        </div>

        {/* Per-test result tables */}
        {order.items.map((item) => (
          <div key={item.id} className="space-y-2">
            <p className="font-semibold">
              {localizedName(item.labTest.name, locale)}
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {item.labTest.code}
              </span>
            </p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">{t('parameterName')}</th>
                  <th className="w-28 py-1.5 pr-2 font-medium">{t('value')}</th>
                  <th className="w-20 py-1.5 pr-2 font-medium">{t('unit')}</th>
                  <th className="py-1.5 pr-2 font-medium">{t('reference')}</th>
                  <th className="w-12 py-1.5 font-medium">{t('flag')}</th>
                </tr>
              </thead>
              <tbody>
                {item.labTest.parameters.map((param) => {
                  const value = savedValues.get(param.id);
                  return (
                    <tr key={param.id} className="border-b border-dashed">
                      <td className="py-1.5 pr-2">{param.name}</td>
                      <td className={cn('py-1.5 pr-2 font-medium', value ? flagClass(value.flag) : '')}>
                        {value?.value ?? '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{param.unit ?? ''}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {referenceText(param.referenceRanges, refLabels)}
                      </td>
                      <td className={cn('py-1.5 font-bold', value ? flagClass(value.flag) : '')}>
                        {value ? flagMark(value.flag) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {item.result?.note ? (
              <p className="text-xs text-muted-foreground">
                {t('note')}: {item.result.note}
              </p>
            ) : null}
          </div>
        ))}

        {/* Approver signature */}
        <div className="flex items-end justify-between pt-8">
          <div>
            <p className="text-muted-foreground">{t('approvedBy')}:</p>
            <p className="font-semibold">{approvedBy?.fullName ?? '________________'}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">{t('signature')}:</p>
            <p className="mt-6 w-48 border-b" />
          </div>
        </div>
      </div>
    </div>
  );
}
