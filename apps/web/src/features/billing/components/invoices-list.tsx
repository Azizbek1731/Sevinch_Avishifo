'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { formatUZS, InvoiceStatus } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz, tashkentToUtcIso } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { useSocketEvent } from '@/hooks/use-socket';
import { PageHeader } from '@/components/page-header';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { billingApi, type InvoiceListItem, type PatientBrief } from '../api';
import { usePermission } from '../hooks';
import { PatientCombobox } from './patient-combobox';
import { NewInvoiceDialog } from './new-invoice-dialog';

const ALL = 'ALL';

export function InvoicesList() {
  const t = useTranslations('billing');
  const queryClient = useQueryClient();
  const can = usePermission();
  const activeBranchId = useAuthStore((s) => s.activeBranchId);

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(ALL);
  const [patient, setPatient] = useState<PatientBrief | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const query = useMemo(
    () => ({
      page,
      status: status === ALL ? undefined : (status as InvoiceStatus),
      patientId: patient?.id,
      branchId: activeBranchId ?? undefined,
      from: from ? tashkentToUtcIso(from, '00:00') : undefined,
      to: to ? tashkentToUtcIso(to, '23:59') : undefined,
    }),
    [page, status, patient, activeBranchId, from, to],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', query],
    queryFn: () => billingApi.listInvoices(query),
    placeholderData: keepPreviousData,
  });

  useSocketEvent('invoice.paid', () => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
  });

  const columns = useMemo<ColumnDef<InvoiceListItem>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('cols.number'),
        cell: ({ row }) => (
          <Link
            href={`/invoices/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'patient',
        header: t('cols.patient'),
        cell: ({ row }) => row.original.patient.fullName,
      },
      {
        accessorKey: 'total',
        header: t('cols.total'),
        cell: ({ row }) => formatUZS(row.original.total),
      },
      {
        accessorKey: 'paidTotal',
        header: t('cols.paid'),
        cell: ({ row }) => formatUZS(row.original.paidTotal),
      },
      {
        accessorKey: 'due',
        header: t('cols.due'),
        cell: ({ row }) => (
          <span className={row.original.due !== '0.00' ? 'font-semibold text-destructive' : undefined}>
            {formatUZS(row.original.due)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('cols.status'),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            label={t(`statuses.${row.original.status}`)}
          />
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('cols.date'),
        cell: ({ row }) => formatTz(row.original.createdAt),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        {can('invoices.write') ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newInvoice')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44 space-y-1">
          <Label className="text-xs text-muted-foreground">{t('filters.status')}</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
              {Object.values(InvoiceStatus).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`statuses.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-xs text-muted-foreground">{t('filters.from')}</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40 space-y-1">
          <Label className="text-xs text-muted-foreground">{t('filters.to')}</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-64 space-y-1">
          <Label className="text-xs text-muted-foreground">{t('filters.patient')}</Label>
          <PatientCombobox
            value={patient}
            clearable
            onChange={(p) => {
              setPatient(p);
              setPage(1);
            }}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        meta={data?.meta}
        isLoading={isLoading}
        onPageChange={setPage}
        emptyText={t('empty.title')}
      />

      <NewInvoiceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
