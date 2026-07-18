'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { AuditAction } from '@avishifo/shared';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { formatTz } from '@/lib/dates';
import { auditApi, splitDiff, type AuditLogRow } from '../api';

const ALL = 'ALL';
const ACTION_VALUES = Object.values(AuditAction);

const ACTION_TONES: Record<string, string> = {
  CREATE: 'ACTIVE', // green
  UPDATE: 'ISSUED', // blue
  DELETE: 'CANCELLED', // red
  LOGIN_FAILED: 'CANCELLED',
  REFUND: 'PARTIALLY_PAID', // amber
};

function DiffCell({ diff }: { diff: unknown }) {
  const t = useTranslations('audit');
  if (diff === null || diff === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  const split = splitDiff(diff);
  return (
    <details className="max-w-96">
      <summary className="cursor-pointer select-none text-sm text-primary hover:underline">
        {t('viewDiff')}
      </summary>
      {split ? (
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t('before')}</p>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs">
              {JSON.stringify(split.before, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t('after')}</p>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs">
              {JSON.stringify(split.after, null, 2)}
            </pre>
          </div>
        </div>
      ) : (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs">
          {JSON.stringify(diff, null, 2)}
        </pre>
      )}
    </details>
  );
}

export function AuditPage() {
  const t = useTranslations('audit');
  const enumLabel = useEnumLabel();

  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState<string>(ALL);
  const [action, setAction] = useState<string>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const entitiesQuery = useQuery({
    queryKey: ['audit-entities'],
    queryFn: () => auditApi.listEntities(),
    staleTime: 5 * 60 * 1000,
  });
  const entities = entitiesQuery.data?.data ?? [];

  const query = useMemo(
    () => ({
      page,
      entity: entity === ALL ? undefined : entity,
      action: action === ALL ? undefined : action,
      from: from || undefined,
      to: to || undefined,
    }),
    [page, entity, action, from, to],
  );

  const logsQuery = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: () => auditApi.listLogs(query),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<AuditLogRow>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('date'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatTz(row.original.createdAt, 'dd.MM.yyyy HH:mm:ss')}</span>
        ),
      },
      {
        accessorKey: 'user',
        header: t('user'),
        cell: ({ row }) =>
          row.original.user ? (
            row.original.user.fullName
          ) : (
            <span className="text-muted-foreground">{t('system')}</span>
          ),
      },
      {
        accessorKey: 'action',
        header: t('action'),
        cell: ({ row }) => (
          <StatusBadge
            status={ACTION_TONES[row.original.action] ?? 'DRAFT'}
            label={enumLabel('audit', row.original.action)}
          />
        ),
      },
      {
        accessorKey: 'entity',
        header: t('entity'),
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.entity}</p>
            {row.original.entityId ? (
              <p className="max-w-40 truncate font-mono text-xs text-muted-foreground">
                {row.original.entityId}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'diff',
        header: t('diff'),
        cell: ({ row }) => <DiffCell diff={row.original.diff} />,
      },
      {
        accessorKey: 'ip',
        header: t('ip'),
        cell: ({ row }) =>
          row.original.ip ? <span className="font-mono text-xs">{row.original.ip}</span> : '—',
      },
    ],
    [t, enumLabel],
  );

  const meta = logsQuery.data?.meta;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('entity')}</p>
          <Select
            value={entity}
            onValueChange={(v) => {
              setEntity(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t('entity')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allEntities')}</SelectItem>
              {entities.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('action')}</p>
          <Select
            value={action}
            onValueChange={(v) => {
              setAction(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t('action')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allActions')}</SelectItem>
              {ACTION_VALUES.map((a) => (
                <SelectItem key={a} value={a}>
                  {enumLabel('audit', a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('from')}</p>
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('to')}</p>
          <Input
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

      <DataTable
        columns={columns}
        data={logsQuery.data?.data ?? []}
        meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
        onPageChange={setPage}
        isLoading={logsQuery.isLoading}
        emptyText={t('empty')}
      />
    </div>
  );
}
