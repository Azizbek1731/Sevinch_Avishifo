'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useSocketEvent } from '@/hooks/use-socket';
import { Link, useRouter } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { useAuthStore } from '@/stores/auth-store';
import { useApiErrorToast } from '@/features/reception/hooks';
import { useDebouncedValue } from '@/features/doctor/hooks';
import { ClinicalOrderDialog } from '@/features/clinical-orders/components/order-dialog';
import {
  clinicalOrdersApi,
  type ClinicalStatus,
} from '@/features/clinical-orders/api';
import {
  useClinicalOrders,
  useClinicalStatusCounts,
  useInvalidateClinicalOrders,
} from '@/features/clinical-orders/hooks';

const STATUSES: Array<ClinicalStatus | 'ALL'> = [
  'ALL',
  'WAITING_PAYMENT',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
];

export function UziWorklist() {
  const t = useTranslations('uzi');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canCreate = Boolean(user?.permissions.includes('invoices.write'));
  const canStart = Boolean(user?.permissions.includes('visits.write'));
  const isDoctor = user?.role === 'DOCTOR';
  const [status, setStatus] = useState<ClinicalStatus | 'ALL'>(isDoctor ? 'READY' : 'WAITING_PAYMENT');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const debounced = useDebouncedValue(search.trim());
  const orders = useClinicalOrders({
    kind: 'ULTRASOUND',
    mine: isDoctor,
    status: status === 'ALL' ? undefined : status,
    search: debounced || undefined,
    page,
    limit: 12,
  });
  const counts = useClinicalStatusCounts('ULTRASOUND');
  const invalidate = useInvalidateClinicalOrders();
  const onError = useApiErrorToast();
  const start = useMutation({
    mutationFn: clinicalOrdersApi.start,
    onError,
    onSuccess: (res) => {
      invalidate();
      router.push(`/doctor/visits/${res.data.visitId}`);
    },
  });

  useSocketEvent('invoice.paid', () => invalidate());

  const total = orders.data?.meta?.total ?? 0;
  const c = counts.data;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        <Button
          variant="outline"
          size="sm"
          disabled={orders.isFetching}
          onClick={() => void orders.refetch()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('refresh')}
        </Button>
        {canCreate ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('newOrder')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['waitingPayment', 'WAITING_PAYMENT', t('status.WAITING_PAYMENT')],
            ['ready', 'READY', t('status.READY')],
            ['inProgress', 'IN_PROGRESS', t('status.IN_PROGRESS')],
            ['completed', 'COMPLETED', t('status.COMPLETED')],
          ] as const
        ).map(([key, value, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-xl border p-4 text-left transition-colors ${
              status === value ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/40'
            }`}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{c?.[key] ?? '—'}</p>
          </button>
        ))}
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
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={status === value ? 'default' : 'outline'}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
            >
              {value === 'ALL' ? t('allStatuses') : t(`status.${value}`)}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t('flowHint')}</p>

      {orders.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-6 text-sm text-destructive">
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
            const unpaid = toTiyin(order.invoice.due) + toTiyin(order.additionalDue);
            return (
              <Card key={order.id} className="overflow-hidden">
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-primary">
                      <Activity className="h-4 w-4" />
                      {t('badge')}
                    </span>
                    <Badge
                      variant={
                        order.status === 'READY'
                          ? 'default'
                          : order.status === 'WAITING_PAYMENT'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
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
                    ) : (
                      <p className="font-medium text-emerald-700">{t('paid')}</p>
                    )}
                  </div>
                  {order.status === 'WAITING_PAYMENT' || unpaid > 0n ? (
                    canCreate ? (
                      <Button variant="outline" className="w-full" asChild>
                        <Link href={`/invoices/${order.invoice.id}`}>
                          {t('openInvoice')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('awaitPayment')}</p>
                    )
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
                  ) : order.status === 'READY' && canStart ? (
                    <Button
                      className="w-full"
                      disabled={start.isPending}
                      onClick={() => start.mutate(order.id)}
                    >
                      {t('startExam')}
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

      {createOpen ? (
        <ClinicalOrderDialog open kind="ULTRASOUND" onOpenChange={setCreateOpen} />
      ) : null}
    </div>
  );
}
