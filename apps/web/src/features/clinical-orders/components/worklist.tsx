'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Activity, ArrowRight, CheckCircle2, Clock3, RefreshCw, Stethoscope } from 'lucide-react';
import { formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiErrorToast } from '@/features/reception/hooks';
import { useDebouncedValue } from '@/features/doctor/hooks';
import { Link, useRouter } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { useAuthStore } from '@/stores/auth-store';
import { clinicalOrdersApi, type ClinicalKind, type ClinicalStatus } from '../api';
import { useClinicalOrders, useInvalidateClinicalOrders } from '../hooks';

export function ClinicalWorklist({ reception = false }: { reception?: boolean }) {
  const t = useTranslations('doctor.clinical');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.permissions.includes('visits.write');
  const [kind, setKind] = useState<ClinicalKind | 'ALL'>('ALL');
  const [status, setStatus] = useState<ClinicalStatus>(reception ? 'WAITING_PAYMENT' : 'READY');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search.trim());
  const orders = useClinicalOrders({
    mine: !reception && user?.role === 'DOCTOR',
    kind: kind === 'ALL' ? undefined : kind,
    status,
    search: debounced || undefined,
    page,
    limit: 12,
  });
  const onError = useApiErrorToast();
  const invalidate = useInvalidateClinicalOrders();
  const start = useMutation({
    mutationFn: clinicalOrdersApi.start,
    onError,
    onSuccess: (res) => {
      invalidate();
      router.push(`/doctor/visits/${res.data.visitId}`);
    },
  });
  const statuses: ClinicalStatus[] = [
    'READY',
    'IN_PROGRESS',
    'WAITING_PAYMENT',
    'COMPLETED',
    'CANCELLED',
  ];
  const total = orders.data?.meta?.total ?? 0;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {t(reception ? 'receptionWorklist' : 'worklist')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(reception ? 'receptionWorklistHint' : 'worklistHint')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={orders.isFetching}
          onClick={() => void orders.refetch()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('refresh')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={tc('search')}
          className="min-w-52 flex-1"
          placeholder={t('search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value as ClinicalKind | 'ALL');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('allKinds')}</SelectItem>
            <SelectItem value="CONSULTATION">{t('consultation')}</SelectItem>
            <SelectItem value="ULTRASOUND">{t('ultrasound')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as ClinicalStatus);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {orders.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 p-6 text-sm text-destructive"
        >
          {t('loadError')}
        </div>
      ) : orders.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4].map((id) => (
            <Skeleton key={id} className="h-52" />
          ))}
        </div>
      ) : !orders.data?.data.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">{t('empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {orders.data.data.map((order) => {
            const Icon = order.kind === 'ULTRASOUND' ? Activity : Stethoscope;
            const unpaid = toTiyin(order.invoice.due) + toTiyin(order.additionalDue);
            return (
              <Card key={order.id} className="overflow-hidden">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-primary">
                      <Icon className="h-4 w-4" />
                      {t(order.kind === 'ULTRASOUND' ? 'ultrasound' : 'consultation')}
                    </span>
                    <Badge variant={order.status === 'READY' ? 'default' : 'outline'}>
                      {t(`status.${order.status}`)}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{order.patient.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.patient.mrn}
                      {order.patient.phone ? ` · ${order.patient.phone}` : ''}
                    </p>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {order.services.map((service) => (
                      <li key={service.id}>
                        {localizedText(service.title, locale)}
                        {service.quantity > 1 ? ` × ${service.quantity}` : ''}
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                    <p>{order.doctor.fullName}</p>
                    <p className="flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {formatTz(order.createdAt)}
                    </p>
                    <p>
                      {order.invoice.number} · {formatUZS(order.invoice.total)}
                    </p>
                    {unpaid > 0n ? (
                      <p className="font-semibold text-amber-700">
                        {t('unpaid', { amount: formatUZS(fromTiyin(unpaid)) })}
                      </p>
                    ) : null}
                  </div>
                  {reception ? (
                    <Button variant="outline" className="w-full" asChild>
                      <Link href={`/invoices/${order.invoice.id}`}>
                        {t('invoice')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : order.status === 'CANCELLED' ? (
                    <p className="text-sm text-muted-foreground">{t('cancelledHint')}</p>
                  ) : order.visitId ? (
                    <Button
                      className="w-full"
                      variant={order.status === 'COMPLETED' ? 'outline' : 'default'}
                      asChild
                    >
                      <Link href={`/doctor/visits/${order.visitId}`}>
                        {t(order.status === 'COMPLETED' ? 'viewReport' : 'continue')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  ) : order.status === 'READY' && canWrite ? (
                    <Button
                      className="w-full"
                      disabled={start.isPending}
                      onClick={() => start.mutate(order.id)}
                    >
                      {t('start')}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('awaitPayment')}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {total > 12 ? (
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            disabled={page <= 1 || orders.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t('previous')}
          </Button>
          <span className="self-center text-sm tabular-nums">
            {page} / {Math.ceil(total / 12)}
          </span>
          <Button
            variant="outline"
            disabled={page * 12 >= total || orders.isFetching}
            onClick={() => setPage(page + 1)}
          >
            {t('next')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
