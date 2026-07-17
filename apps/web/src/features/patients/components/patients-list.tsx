'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Plus, Search, Users } from 'lucide-react';
import { PATIENT_TAGS, formatPhone, formatUZS } from '@avishifo/shared';
import { useRouter } from '@/i18n/routing';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import type { Patient } from '../api';
import { usePatientsList, usePermissions } from '../hooks';
import { PatientFormDialog } from './patient-form-dialog';

const ALL = '__all__';
const PAGE_LIMIT = 20;

export function PatientsList() {
  const t = useTranslations('patients');
  const router = useRouter();
  const can = usePermissions();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tag, setTag] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = usePatientsList({
    page,
    limit: PAGE_LIMIT,
    search: debouncedSearch || undefined,
    tag: tag === ALL ? undefined : tag,
  });

  const items = useMemo(() => query.data?.data ?? [], [query.data]);
  const meta = query.data?.meta;

  const columns = useMemo<ColumnDef<Patient>[]>(
    () => [
      {
        accessorKey: 'mrn',
        header: t('table.mrn'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.mrn}</span>,
      },
      {
        accessorKey: 'fullName',
        header: t('table.fullName'),
        cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      },
      {
        accessorKey: 'phone',
        header: t('table.phone'),
        cell: ({ row }) =>
          row.original.phone ? (
            <span className="whitespace-nowrap">{formatPhone(row.original.phone)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'dob',
        header: t('table.dob'),
        cell: ({ row }) =>
          row.original.dob ? (
            <span className="whitespace-nowrap">
              {formatDate(row.original.dob)}
              {row.original.age !== null ? (
                <span className="text-muted-foreground"> · {t('card.ageYears', { age: row.original.age })}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: 'tags',
        header: t('table.tags'),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.tags.map((tg) => (
              <Badge key={tg} variant="secondary" className="text-xs">
                {t(`tags.${tg}` as never)}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        accessorKey: 'visitCount',
        header: t('table.visits'),
        cell: ({ row }) => row.original.visitCount,
      },
      {
        accessorKey: 'balance',
        header: t('table.balance'),
        cell: ({ row }) => {
          const negative = row.original.balance.startsWith('-');
          return (
            <span className={cn('whitespace-nowrap font-medium', negative && 'text-destructive')}>
              {formatUZS(row.original.balance)}
            </span>
          );
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('table.createdAt'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [t],
  );

  const showEmpty =
    !query.isLoading && items.length === 0 && !debouncedSearch && tag === ALL;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        {can('patients.write') ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newPatient')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <Select
          value={tag}
          onValueChange={(v) => {
            setTag(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('filterTag')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allTags')}</SelectItem>
            {PATIENT_TAGS.map((tg) => (
              <SelectItem key={tg} value={tg}>
                {t(`tags.${tg}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showEmpty ? (
        <EmptyState
          icon={Users}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            can('patients.write') ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t('newPatient')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className="[&_tbody_tr]:cursor-pointer"
          onClick={(e) => {
            if (query.isLoading) return;
            const target = e.target as HTMLElement;
            if (target.closest('a,button')) return;
            const tr = target.closest('tr');
            if (!tr || !tr.closest('tbody')) return;
            const index = Array.from(tr.parentElement?.children ?? []).indexOf(tr);
            const row = items[index];
            if (row) router.push(`/patients/${row.id}`);
          }}
        >
          <DataTable
            columns={columns}
            data={items}
            isLoading={query.isLoading}
            emptyText={t('empty.noResults')}
            meta={
              meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined
            }
            onPageChange={setPage}
          />
        </div>
      )}

      <PatientFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
