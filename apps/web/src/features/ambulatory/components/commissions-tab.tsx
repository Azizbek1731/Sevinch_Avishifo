'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Loader2, Wallet } from 'lucide-react';
import {
  AMBULATORY_SHARE_GROUPS,
  formatUZS,
  type AmbulatoryPaymentState,
  type AmbulatoryShareGroup,
} from '@avishifo/shared';
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

export const groupTone: Record<AmbulatoryShareGroup, string> = {
  LAB: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200',
  UZI: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200',
  EXO: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200',
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
        { key: 'amount', value: formatUZS(data.totals.amount) },
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
          <div className="grid gap-3 md:grid-cols-3">
            {AMBULATORY_SHARE_GROUPS.map((group) => {
              const part = data.totals.byGroup[group];
              return (
                <Card key={group} className={cn('border', groupTone[group])}>
                  <CardContent className="flex items-end justify-between gap-3 p-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                        {t(`groups.${group}`)}
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">
                        {formatUZS(part.commission)}
                      </p>
                    </div>
                    <div className="text-right text-xs opacity-80">
                      <p>{t('commissions.groupOrders', { count: part.orders })}</p>
                      <p className="tabular-nums">
                        {t('commissions.groupPaid', { amount: formatUZS(part.paidAmount) })}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('commissions.calculation', {
              lab: data.defaultPercents.LAB,
              uzi: data.defaultPercents.UZI,
              exo: data.defaultPercents.EXO,
            })}
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
                          {AMBULATORY_SHARE_GROUPS.map((group) => (
                            <TableHead key={group} className="text-right">
                              {t(`groups.${group}`)}
                            </TableHead>
                          ))}
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
                              <p className="text-xs text-muted-foreground">
                                {[
                                  doctor.specialty,
                                  AMBULATORY_SHARE_GROUPS.map(
                                    (group) => `${t(`groups.${group}`)} ${doctor.currentPercents[group]}%`,
                                  ).join(' · '),
                                ]
                                  .filter(Boolean)
                                  .join(' — ')}
                              </p>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {doctor.patients}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{doctor.orders}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatUZS(doctor.paidAmount)}
                            </TableCell>
                            {AMBULATORY_SHARE_GROUPS.map((group) => (
                              <TableCell key={group} className="text-right tabular-nums">
                                {Number(doctor.byGroup[group].commission) > 0
                                  ? formatUZS(doctor.byGroup[group].commission)
                                  : '—'}
                              </TableCell>
                            ))}
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
                          {AMBULATORY_SHARE_GROUPS.map((group) => (
                            <TableCell key={group} className="text-right tabular-nums">
                              {formatUZS(data.totals.byGroup[group].commission)}
                            </TableCell>
                          ))}
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
                        <TableHead>{t('commissions.group')}</TableHead>
                        <TableHead>{t('table.patient')}</TableHead>
                        {!isDoctor ? <TableHead>{t('table.doctor')}</TableHead> : null}
                        <TableHead>{t('commissions.tests')}</TableHead>
                        <TableHead className="text-right">{t('commissions.amount')}</TableHead>
                        <TableHead className="text-right">{t('commissions.paidAmount')}</TableHead>
                        <TableHead className="text-right">{t('commissions.commission')}</TableHead>
                        <TableHead>{t('commissions.payment')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.orders.map((order) => (
                        <TableRow key={`${order.group}:${order.orderId}`}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatTz(order.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={groupTone[order.group]}>
                              {t(`groups.${order.group}`)}
                            </Badge>
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
                            {formatUZS(order.amount)}
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
