'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, BookOpen, FlaskConical, Play, Plus, Syringe } from 'lucide-react';
import { LabOrderStatus } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import { useSocketEvent } from '@/hooks/use-socket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import {
  useDebouncedValue,
  useHasPermission,
  useLabOrders,
  useLabStatusCounts,
  useUpdateOrderStatus,
  WORKLIST_STATUSES,
} from '../hooks';
import type { LabOrderListItem } from '../types';
import { CreateOrderDialog } from './create-order-dialog';
import { hasUnpaidLabWork } from '../lib';
import { ManageTestsDialog } from './manage-tests-dialog';
import { CatalogImportDialog } from './catalog-import-dialog';
import { useReportFilters } from '@/features/reports/hooks';
import { ReportFilterBar } from '@/features/reports/components/report-filter-bar';
import { LabReferralsTab } from '@/features/reports/components/lab-referrals-tab';

const PAGE_SIZE = 20;

export function LabWorklist() {
  const t = useTranslations('lab');
  const locale = useLocale();
  const [reportOpen, setReportOpen] = useState(false);
  const reportFilters = useReportFilters();
  const tc = useTranslations('common');
  const canWrite = useHasPermission('lab.orders.write');
  const canPerform = useHasPermission('lab.results.write');
  const canManageTests = useHasPermission('services.write');
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<LabOrderStatus | undefined>(undefined);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const ordersQuery = useLabOrders({
    includeUnpaid: canWrite && !canPerform,
    status,
    search: debouncedSearch,
    page,
    limit: PAGE_SIZE,
  });
  const counts = useLabStatusCounts(canWrite && !canPerform);
  const updateStatus = useUpdateOrderStatus();

  useSocketEvent('lab.order.updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['lab', 'orders'] });
  });

  useSocketEvent('invoice.paid', () => {
    void queryClient.invalidateQueries({ queryKey: ['lab'] });
  });

  const columns = useMemo<ColumnDef<LabOrderListItem>[]>(
    () => [
      {
        accessorKey: 'orderNumber',
        header: t('colOrder'),
        cell: ({ row }) => (
          <Link
            href={`/lab/${row.original.id}`}
            className="font-mono text-sm font-medium hover:underline"
          >
            {row.original.orderNumber}
          </Link>
        ),
      },
      {
        id: 'patient',
        header: tc('patient'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.patient.fullName}</p>
            <p className="text-xs text-muted-foreground">{row.original.patient.mrn}</p>
          </div>
        ),
      },
      {
        id: 'referringDoctor',
        header: t('referringDoctor'),
        cell: ({ row }) => (
          <span>{row.original.referringDoctor?.fullName ?? t('directOrder')}</span>
        ),
      },
      {
        accessorKey: 'itemCount',
        header: t('colTests'),
        cell: ({ row }) => (
          <div className="max-w-sm space-y-1">
            {row.original.tests.map((test) => (
              <p key={test.id} className="text-sm">
                {localizedText(test.name, locale) || test.code}
              </p>
            ))}
          </div>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: tc('date'),
        cell: ({ row }) =>
          row.original.createdAt ? (
            <span className="text-sm text-muted-foreground">
              {formatTz(row.original.createdAt)}
            </span>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'status',
        header: tc('status'),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            label={
              hasUnpaidLabWork(row.original)
                ? t('paymentWaiting')
                : t(`status.${row.original.status}` as never)
            }
          />
        ),
      },
      {
        id: 'actions',
        header: tc('actions'),
        cell: ({ row }) => {
          const order = row.original;
          return (
            <div className="flex items-center justify-end gap-2">
              {canPerform && order.canWork && order.status === LabOrderStatus.ORDERED ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({
                      id: order.id,
                      status: LabOrderStatus.SPECIMEN_COLLECTED,
                    })
                  }
                >
                  <Syringe className="h-4 w-4" />
                  {t('actionCollect')}
                </Button>
              ) : null}
              {canPerform && order.canWork && order.status === LabOrderStatus.SPECIMEN_COLLECTED ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={updateStatus.isPending}
                  onClick={() =>
                    updateStatus.mutate({ id: order.id, status: LabOrderStatus.IN_PROGRESS })
                  }
                >
                  <Play className="h-4 w-4" />
                  {t('actionStart')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/lab/${order.id}`}>
                  {t('open')}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          );
        },
      },
    ],
    [t, tc, locale, canPerform, updateStatus],
  );

  const meta = ordersQuery.data?.meta;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        {canManageTests ? (
          <>
            <Button variant="outline" onClick={() => setCatalogOpen(true)}>
              <BookOpen className="h-4 w-4" />
              {t('catalogButton')}
            </Button>
            <Button variant="outline" onClick={() => setTestsOpen(true)}>
              <FlaskConical className="h-4 w-4" />
              {t('manageTests')}
            </Button>
          </>
        ) : null}
        {canWrite ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('newOrder')}
          </Button>
        ) : null}
      </PageHeader>

      <Button
        variant="outline"
        aria-expanded={reportOpen}
        onClick={() => setReportOpen((value) => !value)}
      >
        {t(reportOpen ? 'referralReportHide' : 'referralReportShow')}
      </Button>
      {reportOpen ? (
        <section className="space-y-4 rounded-xl border p-4">
          <ReportFilterBar state={reportFilters.state} onChange={reportFilters.setState} />
          <LabReferralsTab filters={reportFilters.filters} />
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(
            'inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors hover:bg-muted md:min-h-0 md:px-3 md:py-1',
            status === undefined && 'border-primary bg-primary/10 font-medium text-primary',
          )}
          onClick={() => {
            setStatus(undefined);
            setPage(1);
          }}
        >
          {tc('all')}
        </button>
        {WORKLIST_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors hover:bg-muted md:min-h-0 md:px-3 md:py-1',
              status === s && 'border-primary bg-primary/10 font-medium text-primary',
            )}
            onClick={() => {
              setStatus(status === s ? undefined : s);
              setPage(1);
            }}
          >
            {t(`status.${s}` as never)}
            <span className="ml-1.5 tabular-nums text-muted-foreground">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <Input
        className="max-w-sm"
        placeholder={t('searchPlaceholder')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />

      <DataTable
        columns={columns}
        data={ordersQuery.data?.data ?? []}
        meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
        onPageChange={setPage}
        isLoading={ordersQuery.isLoading}
        emptyText={t('emptyWorklist')}
      />

      <CreateOrderDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ManageTestsDialog open={testsOpen} onOpenChange={setTestsOpen} />
      <CatalogImportDialog open={catalogOpen} onOpenChange={setCatalogOpen} />
    </div>
  );
}
