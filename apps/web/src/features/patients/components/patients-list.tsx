'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Loader2, Plus, Search, Trash2, Users } from 'lucide-react';
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
import { formatDate, todayTashkent } from '@/lib/dates';
import type { Patient, PatientListQuery } from '../api';
import { patientsApi } from '../api';
import { useApiErrorToast, usePatientsList, usePermissions } from '../hooks';
import { PatientFormDialog } from './patient-form-dialog';

const ALL = '__all__';
const PAGE_LIMIT = 20;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function PatientsList() {
  const t = useTranslations('patients');
  const router = useRouter();
  const can = usePermissions();
  const errorToast = useApiErrorToast();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tag, setTag] = useState<string>(ALL);
  const [careType, setCareType] = useState<string>(ALL);
  const [gender, setGender] = useState<string>(ALL);
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  // Only management can ask for these, and only they are offered the switch.
  const canSeeDeleted = can('records.viewDeleted');
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const listFilters: Omit<PatientListQuery, 'page' | 'limit'> = {
    search: debouncedSearch || undefined,
    tag: tag === ALL ? undefined : tag,
    careType: careType === 'AMBULATORY' || careType === 'INPATIENT' ? careType : undefined,
    gender: gender === 'MALE' || gender === 'FEMALE' ? gender : undefined,
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
    deleted: showDeleted || undefined,
  };

  const query = usePatientsList({
    page,
    limit: PAGE_LIMIT,
    ...listFilters,
  });

  const exportXlsx = useMutation({
    mutationFn: () => patientsApi.exportXlsx(listFilters),
    onSuccess: (blob) => {
      downloadBlob(blob, `bemorlar_${todayTashkent()}.xlsx`);
      toast.success(t('export.success'));
    },
    onError: errorToast,
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
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span
              className={`font-medium ${row.original.deletedAt ? 'text-muted-foreground line-through' : ''}`}
            >
              {row.original.fullName}
            </span>
            {row.original.deletedAt ? (
              <Badge variant="outline" className="shrink-0">
                {t('deletedBadge')}
              </Badge>
            ) : null}
          </span>
        ),
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
    !query.isLoading &&
    items.length === 0 &&
    !debouncedSearch &&
    tag === ALL &&
    careType === ALL &&
    gender === ALL &&
    !createdFrom &&
    !createdTo;

  const hasFilters =
    Boolean(debouncedSearch || createdFrom || createdTo) ||
    tag !== ALL ||
    careType !== ALL ||
    gender !== ALL ||
    showDeleted;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        <div className="flex flex-wrap gap-2">
          {can('patients.export') ? (
            <Button
              type="button"
              variant="outline"
              disabled={exportXlsx.isPending}
              onClick={() => exportXlsx.mutate()}
            >
              {exportXlsx.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t('export.xlsx')}
            </Button>
          ) : null}
          {can('patients.write') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newPatient')}
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-2">
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
        <Select
          value={careType}
          onValueChange={(v) => {
            setCareType(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('form.careType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allCareTypes')}</SelectItem>
            <SelectItem value="AMBULATORY">{t('form.careTypes.AMBULATORY')}</SelectItem>
            <SelectItem value="INPATIENT">{t('form.careTypes.INPATIENT')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={gender}
          onValueChange={(v) => {
            setGender(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('form.gender')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allGenders')}</SelectItem>
            <SelectItem value="MALE">{t('filters.male')}</SelectItem>
            <SelectItem value="FEMALE">{t('filters.female')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={createdFrom}
            onChange={(e) => {
              setCreatedFrom(e.target.value);
              setPage(1);
            }}
            className="w-40"
            aria-label={t('filters.from')}
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            value={createdTo}
            onChange={(e) => {
              setCreatedTo(e.target.value);
              setPage(1);
            }}
            className="w-40"
            aria-label={t('filters.to')}
          />
        </div>
        {canSeeDeleted ? (
          <Button
            type="button"
            variant={showDeleted ? 'default' : 'outline'}
            onClick={() => {
              setShowDeleted((v) => !v);
              setPage(1);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('showDeleted')}
          </Button>
        ) : null}
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setTag(ALL);
              setCareType(ALL);
              setGender(ALL);
              setCreatedFrom('');
              setCreatedTo('');
              setShowDeleted(false);
              setPage(1);
            }}
          >
            {t('filters.clear')}
          </Button>
        ) : null}
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
