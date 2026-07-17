'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { NotificationChannel, NotificationStatus } from '@avishifo/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { formatTz } from '@/lib/dates';
import { settingsApi, type NotificationLogRow } from '../api';

const ALL = 'ALL';
const STATUS_VALUES = Object.values(NotificationStatus);
const CHANNEL_VALUES = Object.values(NotificationChannel);

export function LogsTab() {
  const t = useTranslations('notifications');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(ALL);
  const [channel, setChannel] = useState<string>(ALL);

  const query = useMemo(
    () => ({
      page,
      status: status === ALL ? undefined : status,
      channel: channel === ALL ? undefined : channel,
    }),
    [page, status, channel],
  );

  const logsQuery = useQuery({
    queryKey: ['notification-logs', query],
    queryFn: () => settingsApi.listNotificationLogs(query),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<ColumnDef<NotificationLogRow>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('logs.date'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatTz(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: 'recipient',
        header: t('logs.recipient'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.recipient}</span>,
      },
      {
        accessorKey: 'event',
        header: t('logs.event'),
        cell: ({ row }) => t(`events.${row.original.event}` as never),
      },
      {
        accessorKey: 'channel',
        header: t('logs.channel'),
        cell: ({ row }) => t(`channels.${row.original.channel}` as never),
      },
      {
        accessorKey: 'body',
        header: t('logs.body'),
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-72 text-sm text-muted-foreground">
            {row.original.body}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('logs.status'),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <StatusBadge
              status={row.original.status}
              label={t(`logs.statuses.${row.original.status}` as never)}
            />
            {row.original.error ? (
              <p className="max-w-48 truncate text-xs text-destructive">{row.original.error}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'attempts',
        header: t('logs.attempts'),
      },
    ],
    [t],
  );

  const meta = logsQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('logs.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('logs.allStatuses')}</SelectItem>
            {STATUS_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`logs.statuses.${s}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={channel}
          onValueChange={(v) => {
            setChannel(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('logs.channel')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('logs.allChannels')}</SelectItem>
            {CHANNEL_VALUES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`channels.${c}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={logsQuery.data?.data ?? []}
        meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
        onPageChange={setPage}
        isLoading={logsQuery.isLoading}
        emptyText={t('logs.empty')}
      />
    </div>
  );
}
