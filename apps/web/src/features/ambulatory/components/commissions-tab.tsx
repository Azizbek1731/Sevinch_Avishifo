'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Loader2, Wallet } from 'lucide-react';
import { formatUZS, type AmbulatoryPaymentState } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz, todayTashkent } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuthStore } from '@/stores/auth-store';
import { useApiErrorToast } from '@/features/services/hooks';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import { ambulatoryApi } from '../api';

const ALL = '__all__';

function monthStart(): string {
  return `${todayTashkent().slice(0, 8)}01`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const paymentBadge: Record<AmbulatoryPaymentState, 'default' | 'secondary' | 'outline'> = {
  PAID: 'default',
  PARTIAL: 'secondary',
  UNPAID: 'outline',
};

export function CommissionsTab() {
  const t = useTranslations('ambulatory');
  const locale = useLocale();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const isDoctor = useAuthStore((s) => s.user?.role === 'DOCTOR');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayTashkent);
  const [doctorId, setDoctorId] = useState(ALL);

  const filters = {
    from,
    to,
    doctorUserId: !isDoctor && doctorId !== ALL ? doctorId : undefined,
  };
  const validRange = Boolean(from && to && from <= to);

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: !isDoctor && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });
  const doctorOptions = useMemo(
    () => (doctors.data ?? []).filter((doctor) => !isUziSpecialty(doctor.specialty)),
    [doctors.data],
  );

  const report = useQuery({
    queryKey: ['ambulatory', 'commissions', branchId, filters],
    enabled: validRange,
    queryFn: async () => (await ambulatoryApi.commissions(filters)).data,
    refetchInterval: 30_000,
  });

  const exportXlsx = useMutation({
    mutationFn: () => ambulatoryApi.exportCommissions(filters),
    onSuccess: (blob) => {
      downloadBlob(blob, `ambulator-ulush_${from}_${to}.xlsx`);
      toast.success(t('commissions.exported'));
    },
    onError: errorToast,
  });

  const data = report.data;
  const cards = data
    ? [
        { key: 'commission', value: formatUZS(data.totals.commission), accent: true },
        { key: 'pendingCommission', value: formatUZS(data.totals.pendingCommission) },
        { key: 'paidAmount', value: formatUZS(data.totals.paidAmount) },
        { key: 'labAmount', value: formatUZS(data.totals.labAmount) },
        { key: 'patients', value: data.totals.patients.toLocaleString(locale) },
        { key: 'orders', value: data.totals.orders.toLocaleString(locale) },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="w-40"
              aria-label={t('filters.from')}
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="w-40"
              aria-label={t('filters.to')}
            />
          </div>
          {!isDoctor ? (
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="w-60">
                <SelectValue placeholder={t('fields.doctor')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('filters.allDoctors')}</SelectItem>
                {doctorOptions.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!validRange || exportXlsx.isPending}
          onClick={() => exportXlsx.mutate()}
        >
          {exportXlsx.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {t('export')}
        </Button>
      </div>

      {report.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {cards.map((card) => (
              <Card key={card.key} className={cn(card.accent && 'border-primary/40 bg-primary/5')}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t(`commissions.${card.key}`)}</p>
                  <p
                    className={cn(
                      'mt-2 text-xl font-semibold tabular-nums',
                      card.accent && 'text-primary',
                    )}
                  >
                    {card.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('commissions.calculation', { percent: data.defaultPercent })}
          </p>

          {data.orders.length === 0 ? (
            <Card>
              <CardContent className="p-8">
                <EmptyState
                  icon={Wallet}
                  title={t('commissions.emptyTitle')}
                  description={t('commissions.emptyDescription')}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {!isDoctor ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t('commissions.byDoctor')}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('table.doctor')}</TableHead>
                          <TableHead className="text-right">{t('commissions.patients')}</TableHead>
                          <TableHead className="text-right">{t('commissions.orders')}</TableHead>
                          <TableHead className="text-right">{t('commissions.paidAmount')}</TableHead>
                          <TableHead className="text-right">{t('commissions.percent')}</TableHead>
                          <TableHead className="text-right">{t('commissions.commission')}</TableHead>
                          <TableHead className="text-right">
                            {t('commissions.pendingCommission')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.doctors.map((doctor) => (
                          <TableRow
                            key={doctor.doctorUserId}
                            className="cursor-pointer"
                            onClick={() => setDoctorId(doctor.doctorUserId)}
                          >
                            <TableCell>
                              <p className="font-medium">{doctor.doctorName}</p>
                              {doctor.specialty ? (
                                <p className="text-xs text-muted-foreground">{doctor.specialty}</p>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {doctor.patients}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{doctor.orders}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatUZS(doctor.paidAmount)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {doctor.currentPercent}%
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-primary">
                              {formatUZS(doctor.commission)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatUZS(doctor.pendingCommission)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell>{t('commissions.total')}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {data.totals.patients}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {data.totals.orders}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUZS(data.totals.paidAmount)}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatUZS(data.totals.commission)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUZS(data.totals.pendingCommission)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('commissions.byOrder')}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('commissions.date')}</TableHead>
                        <TableHead>{t('table.patient')}</TableHead>
                        {!isDoctor ? <TableHead>{t('table.doctor')}</TableHead> : null}
                        <TableHead>{t('commissions.tests')}</TableHead>
                        <TableHead className="text-right">{t('commissions.labAmount')}</TableHead>
                        <TableHead className="text-right">{t('commissions.paidAmount')}</TableHead>
                        <TableHead className="text-right">{t('commissions.commission')}</TableHead>
                        <TableHead>{t('commissions.payment')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.orders.map((order) => (
                        <TableRow key={order.orderId}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatTz(order.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/ambulatory/${order.caseId}`}
                              className="font-medium hover:underline"
                            >
                              {order.patient.fullName}
                            </Link>
                            <p className="font-mono text-xs text-muted-foreground">
                              {order.caseNumber} · {order.orderNumber}
                            </p>
                          </TableCell>
                          {!isDoctor ? (
                            <TableCell className="text-muted-foreground">
                              {order.doctorName}
                            </TableCell>
                          ) : null}
                          <TableCell className="max-w-72">
                            <p className="line-clamp-2 text-sm">
                              {order.tests.map((name) => localizedText(name, locale)).join(', ')}
                            </p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUZS(order.labAmount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUZS(order.paidAmount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="font-semibold text-primary">
                              {formatUZS(order.commission)}
                            </span>
                            <p className="text-xs text-muted-foreground">{order.percent}%</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={paymentBadge[order.paymentState]}>
                              {t(`payment.${order.paymentState}`)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
