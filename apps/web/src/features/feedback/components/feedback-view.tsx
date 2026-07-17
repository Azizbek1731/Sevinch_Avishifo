'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, MessageSquareHeart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  feedbackApi,
  LOW_RATING_THRESHOLD,
  type FeedbackRow,
  type FeedbackStats,
  type RatingKey,
} from '../api';
import { useApiErrorToast, usePermission } from '../hooks';
import { RatingStars } from './rating-stars';

const ALL = 'ALL';
const RATING_KEYS_DESC: RatingKey[] = ['5', '4', '3', '2', '1'];

function StatsHeader({ stats }: { stats: FeedbackStats }) {
  const t = useTranslations('feedback');
  const maxBucket = Math.max(1, ...RATING_KEYS_DESC.map((k) => stats.distribution[k]));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('stats.avgTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <span className="text-5xl font-bold leading-none">
            {stats.avg !== null ? stats.avg.toFixed(1) : '—'}
          </span>
          <RatingStars rating={stats.avg ?? 0} sizeClassName="h-5 w-5" />
          <p className="text-sm text-muted-foreground">
            {t('stats.total', { count: stats.count })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('stats.distributionTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {RATING_KEYS_DESC.map((k) => {
            const count = stats.distribution[k];
            return (
              <div key={k} className="flex items-center gap-2 text-sm">
                <span className="w-3 text-right font-medium">{k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      Number(k) <= LOW_RATING_THRESHOLD ? 'bg-destructive' : 'bg-warning',
                    )}
                    style={{ width: `${(count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t('stats.perDoctorTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-56 overflow-y-auto p-0">
          {stats.perDoctor.length === 0 ? (
            <p className="px-6 pb-4 text-sm text-muted-foreground">{t('stats.noData')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('stats.columns.doctor')}</TableHead>
                  <TableHead className="text-right">{t('stats.columns.avg')}</TableHead>
                  <TableHead className="text-right">{t('stats.columns.count')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.perDoctor.map((row) => (
                  <TableRow key={row.doctor.id}>
                    <TableCell className="font-medium">
                      {row.doctor.fullName ?? t('list.anonymous')}
                    </TableCell>
                    <TableCell className="text-right">{row.avg.toFixed(1)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeedbackCard({
  row,
  canToggle,
  onToggle,
  togglePending,
}: {
  row: FeedbackRow;
  canToggle: boolean;
  onToggle: (id: string, isPublic: boolean) => void;
  togglePending: boolean;
}) {
  const t = useTranslations('feedback');
  const low = row.rating <= LOW_RATING_THRESHOLD;

  return (
    <Card className={cn(low && 'border-destructive')}>
      <CardContent className="space-y-2 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <RatingStars rating={row.rating} />
            <span className="text-sm font-medium">
              {row.patient?.fullName ?? t('list.anonymous')}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{formatTz(row.createdAt)}</span>
        </div>
        {row.doctor ? (
          <p className="text-sm text-muted-foreground">
            {t('list.doctorLabel')}: {row.doctor.fullName}
          </p>
        ) : null}
        {row.comment ? <p className="text-sm">{row.comment}</p> : null}
        {canToggle ? (
          <div className="flex items-center justify-end gap-2 pt-1">
            <span className="text-xs text-muted-foreground">{t('list.publicLabel')}</span>
            <Switch
              checked={row.isPublic}
              disabled={togglePending}
              onCheckedChange={(checked) => onToggle(row.id, checked)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function FeedbackView() {
  const t = useTranslations('feedback');
  const can = usePermission();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();

  const [doctorUserId, setDoctorUserId] = useState<string | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const statsQuery = useQuery({
    queryKey: ['feedback', 'stats'],
    queryFn: () => feedbackApi.stats(),
  });

  const listQuery = useQuery({
    queryKey: ['feedback', 'list', { doctorUserId, minRating, page }],
    queryFn: () => feedbackApi.list({ doctorUserId, minRating, page }),
    placeholderData: keepPreviousData,
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      feedbackApi.setVisibility(id, isPublic),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feedback'] });
      toast.success(t('list.visibilityUpdated'));
    },
    onError: errorToast,
  });

  const canToggle = can('clinic.settings.write');
  const rows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;
  const pageCount = meta ? Math.max(1, Math.ceil(meta.total / Math.max(1, meta.limit))) : 1;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} />

      {statsQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : statsQuery.data ? (
        <StatsHeader stats={statsQuery.data} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={doctorUserId ?? ALL}
          onValueChange={(v) => {
            setDoctorUserId(v === ALL ? null : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t('filters.doctor')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allDoctors')}</SelectItem>
            {(statsQuery.data?.perDoctor ?? []).map((d) => (
              <SelectItem key={d.doctor.id} value={d.doctor.id}>
                {d.doctor.fullName ?? t('list.anonymous')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={minRating !== null ? String(minRating) : ALL}
          onValueChange={(v) => {
            setMinRating(v === ALL ? null : Number(v));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('filters.minRating')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.anyRating')}</SelectItem>
            {[5, 4, 3, 2, 1].map((r) => (
              <SelectItem key={r} value={String(r)}>
                {t('filters.stars', { count: r })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title={t('list.empty.title')}
          description={t('list.empty.description')}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <FeedbackCard
              key={row.id}
              row={row}
              canToggle={canToggle}
              togglePending={visibilityMutation.isPending}
              onToggle={(id, isPublic) => visibilityMutation.mutate({ id, isPublic })}
            />
          ))}
        </div>
      )}

      {meta && pageCount > 1 ? (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-muted-foreground">
            {t('list.page', { page: meta.page, pageCount, total: meta.total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={listQuery.isFetching || meta.page <= 1}
              onClick={() => setPage(meta.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('list.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={listQuery.isFetching || meta.page >= pageCount}
              onClick={() => setPage(meta.page + 1)}
            >
              {t('list.next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
