'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatUZS } from '@avishifo/shared';
import { ArrowRight, Plus, Search, Scissors } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { usePermissions } from '@/hooks/use-permissions';
import { localizedText } from '@/lib/localized';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedValue } from '@/features/doctor/hooks';
import { useSurgeries } from '../hooks';
import type { SurgeryStatus } from '../api';
import { CreateSurgeryDialog } from './create-dialog';

export function SurgeriesPanel({
  admissionId,
  allowSchedule = true,
  initialStatus = 'ALL',
}: {
  admissionId?: string;
  allowSchedule?: boolean;
  initialStatus?: SurgeryStatus | 'ALL';
}) {
  const t = useTranslations('surgeries');
  const locale = useLocale();
  const can = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SurgeryStatus | 'ALL'>(initialStatus);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 300);
  const invalidDates = Boolean(from && to && from > to);
  const query = useSurgeries(
    {
      admissionId,
      page,
      limit: 15,
      search: debouncedSearch || undefined,
      status: status === 'ALL' ? undefined : status,
      from: from || undefined,
      to: to || undefined,
    },
    can('surgery.read') && !invalidDates,
  );
  if (!can('surgery.read')) return <EmptyState icon={Scissors} title={t('forbidden')} />;
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t(admissionId ? 'admissionHint' : 'listHint')}
        </p>
        {can('surgery.schedule') && allowSchedule ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('schedule')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1 space-y-2">
          <Label htmlFor="surgery-search">{t('search')}</Label>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="surgery-search"
              className="pl-9"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="w-44 space-y-2">
          <Label>{t('statusLabel')}</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as SurgeryStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              {(['PLANNED', 'COMPLETED', 'CANCELLED'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`status.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="surgery-from">{t('from')}</Label>
          <Input
            id="surgery-from"
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="surgery-to">{t('to')}</Label>
          <Input
            id="surgery-to"
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      {invalidDates ? (
        <p role="alert" className="text-sm text-destructive">
          {t('invalidDates')}
        </p>
      ) : query.isError ? (
        <div role="alert" className="rounded-lg border p-4 text-sm text-destructive">
          {t('loadError')}{' '}
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : query.isLoading ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Scissors} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <div className="space-y-3">
          {rows.map((surgery) => (
            <Card key={surgery.id}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-52 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{surgery.patient.fullName}</h3>
                    <Badge variant={surgery.status === 'COMPLETED' ? 'default' : 'outline'}>
                      {t(`status.${surgery.status}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium">
                    {localizedText(surgery.service.name, locale)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {surgery.patient.mrn} · {surgery.admission.historyNumber} ·{' '}
                    {surgery.scheduledDate.slice(0, 10)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('surgeon')}: {surgery.surgeon.fullName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{t('total')}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatUZS(surgery.totalAmount)}
                  </p>
                  {surgery.status === 'COMPLETED' &&
                  (can('surgery.payout') || can('payroll.read')) ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(
                        surgery.payouts.some((payout) => !payout.voidedAt)
                          ? 'paidOut'
                          : 'awaitingPayout',
                      )}
                    </p>
                  ) : null}
                </div>
                <Button asChild variant="outline">
                  <Link href={`/surgeries/${surgery.id}`}>
                    {t('details')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!invalidDates && query.data?.meta ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('count', { count: query.data.meta.total })}
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('previous')}
            </Button>
            <span>{page}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * 15 >= query.data.meta.total}
              onClick={() => setPage(page + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </div>
      ) : null}
      {can('surgery.schedule') && allowSchedule ? (
        <CreateSurgeryDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          admissionId={admissionId}
        />
      ) : null}
    </div>
  );
}
