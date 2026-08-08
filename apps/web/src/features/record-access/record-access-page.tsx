'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ShieldOff, X } from 'lucide-react';
import type { RecordAccessRequestDto, RecordAccessStatus } from '@avishifo/shared';
import { api, ApiError, type ApiResult } from '@/lib/api-client';
import { formatTz } from '@/lib/dates';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Paged = { items: RecordAccessRequestDto[]; total: number; page: number; limit: number };

const STATUS_VARIANT: Record<RecordAccessStatus, 'default' | 'secondary' | 'destructive' | 'outline'> =
  {
    PENDING: 'default',
    APPROVED: 'secondary',
    REJECTED: 'destructive',
    REVOKED: 'outline',
  };

/**
 * Where a clinic decides whether a patient may read their own clinical history
 * in the portal or the bot. Lab results never appear here — they are the
 * patient's the moment they are approved. This screen is only about the
 * narrative record: diagnoses, prescriptions, the doctor's plan.
 */
export function RecordAccessPage() {
  const t = useTranslations('recordAccess');
  const tErr = useTranslations('errors');
  const qc = useQueryClient();
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'ALL'>('PENDING');

  const query = useQuery({
    queryKey: ['record-access', tab],
    queryFn: async (): Promise<ApiResult<Paged>> =>
      api.get<Paged>('/record-access', {
        ...(tab === 'ALL' ? {} : { status: tab }),
        pageSize: 50,
      }),
  });

  const decide = useMutation({
    mutationFn: async (v: { id: string; status: RecordAccessStatus }) =>
      api.patch(`/record-access/${v.id}`, { status: v.status }),
    onSuccess: async (_d, v) => {
      await qc.invalidateQueries({ queryKey: ['record-access'] });
      toast.success(
        v.status === 'APPROVED'
          ? t('toast.approved')
          : v.status === 'REJECTED'
            ? t('toast.rejected')
            : t('toast.revoked'),
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? tErr(err.code as never) : tErr('INTERNAL_ERROR')),
  });

  const rows = query.data?.data.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="PENDING">{t('tabs.pending')}</TabsTrigger>
          <TabsTrigger value="APPROVED">{t('tabs.approved')}</TabsTrigger>
          <TabsTrigger value="ALL">{t('tabs.all')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          {query.isPending ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <ShieldOff className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.patient')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('columns.note')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('columns.requestedAt')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead className="text-right">{t('columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.patient.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.patient.mrn}
                        {r.patient.phone ? ` · ${r.patient.phone}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-64 truncate text-sm text-muted-foreground md:table-cell">
                      {r.patientNote ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatTz(r.requestedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
                      {r.decidedBy ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.decidedBy.fullName}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Narrow screens keep the icons and drop the labels — three
                          words of Uzbek per button would push the row off-screen. */}
                      {r.status === 'PENDING' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={decide.isPending}
                            aria-label={t('actions.approve')}
                            onClick={() => decide.mutate({ id: r.id, status: 'APPROVED' })}
                          >
                            <Check className="h-4 w-4" />
                            <span className="hidden lg:inline">{t('actions.approve')}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decide.isPending}
                            aria-label={t('actions.reject')}
                            onClick={() => decide.mutate({ id: r.id, status: 'REJECTED' })}
                          >
                            <X className="h-4 w-4" />
                            <span className="hidden lg:inline">{t('actions.reject')}</span>
                          </Button>
                        </div>
                      ) : r.status === 'APPROVED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          aria-label={t('actions.revoke')}
                          onClick={() => decide.mutate({ id: r.id, status: 'REVOKED' })}
                        >
                          <ShieldOff className="h-4 w-4" />
                          <span className="hidden lg:inline">{t('actions.revoke')}</span>
                        </Button>
                      ) : null}
                    </TableCell>
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
