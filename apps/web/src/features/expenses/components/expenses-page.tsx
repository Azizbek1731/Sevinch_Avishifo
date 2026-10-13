'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Banknote, Pencil, Plus, Tags, Trash2, Wallet } from 'lucide-react';
import { formatUZS, type ExpenseMethod } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { Link } from '@/i18n/routing';
import { usePermissions } from '@/hooks/use-permissions';
import { PageHeader } from '@/components/page-header';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EXTERNAL_PAYMENT_METHODS } from '@/features/billing/payment-methods';
import { useAuthStore } from '@/stores/auth-store';
import { useApiErrorToast } from '@/features/services/hooks';
import { expensesApi, todayInTashkent, type ExpenseRow } from '../api';
import { ExpenseDialog } from './expense-dialog';
import { CategoriesDialog } from './categories-dialog';

const ALL = '__all__';
const PAGE_LIMIT = 20;
const METHODS = EXTERNAL_PAYMENT_METHODS;

/** First day of the current month, in Tashkent. */
function monthStart(): string {
  return `${todayInTashkent().slice(0, 7)}-01`;
}

/** Record spending against cash, card or Click and review a selected period. */
export function ExpensesPage() {
  const t = useTranslations('expenses');
  const can = usePermissions();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const activeBranchId = useAuthStore((state) => state.activeBranchId);

  const canWrite = can('expenses.write');
  const canSeeDeleted = can('records.viewDeleted');

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayInTashkent);
  const [categoryId, setCategoryId] = useState(ALL);
  const [method, setMethod] = useState<string>(ALL);
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ExpenseRow | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['expenses', 'categories'],
    queryFn: async () => (await expensesApi.categories()).data,
  });

  const filters = {
    from,
    to,
    categoryId: categoryId === ALL ? undefined : categoryId,
    method: method === ALL ? undefined : (method as ExpenseMethod),
    deleted: showDeleted || undefined,
    page,
    limit: PAGE_LIMIT,
  };

  const query = useQuery({
    queryKey: ['expenses', 'list', activeBranchId, filters],
    queryFn: async () => (await expensesApi.list(filters)).data,
  });

  const remove = useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      toast.success(t('deleted'));
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      // Withdrawing a cash expense puts the money back into what the drawer
      // is expected to hold.
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: errorToast,
  });

  const categories = categoriesQuery.data ?? [];
  const items = query.data?.items ?? [];
  const meta = query.data?.meta;

  const columns = useMemo<ColumnDef<ExpenseRow>[]>(() => {
    const base: ColumnDef<ExpenseRow>[] = [
      {
        accessorKey: 'date',
        header: t('table.date'),
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.date}</span>,
      },
      {
        accessorKey: 'category',
        header: t('table.category'),
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{row.original.category?.name ?? '—'}</span>
            {row.original.deletedAt ? (
              <Badge variant="outline" className="shrink-0">
                {t('deletedBadge')}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'method',
        header: t('table.method'),
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {row.original.method === 'CASH' ? (
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
            ) : null}
            {t(`methods.${row.original.method}` as never)}
          </span>
        ),
      },
      {
        accessorKey: 'note',
        header: t('table.note'),
        cell: ({ row }) => (
          <span className="block max-w-[40ch] whitespace-normal break-words text-muted-foreground">
            {row.original.note || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'amount',
        header: t('table.amount'),
        cell: ({ row }) => (
          <span
            className={`block whitespace-nowrap text-right font-medium ${
              row.original.deletedAt ? 'text-muted-foreground line-through' : ''
            }`}
          >
            {formatUZS(row.original.amount)}
          </span>
        ),
      },
    ];
    if (!canWrite) return base;
    return [
      ...base,
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.surgeryId ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/surgeries/${row.original.surgeryId}`}>{t('surgeryDetails')}</Link>
            </Button>
          ) : row.original.deletedAt ? null : (
            <span className="flex justify-end gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => {
                  setEditing(row.original);
                  setFormOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                <span className="sr-only">{t('edit')}</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                onClick={() => setPendingDelete(row.original)}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">{t('delete')}</span>
              </Button>
            </span>
          ),
      },
    ];
  }, [t, canWrite]);

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')}>
        {canWrite ? (
          <>
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <Tags className="mr-2 h-4 w-4" />
              {t('categoriesTitle')}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('add')}
            </Button>
          </>
        ) : null}
      </PageHeader>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const today = todayInTashkent();
                setFrom(today);
                setTo(today);
                setPage(1);
              }}
            >
              {t('today')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFrom(monthStart());
                setTo(todayInTashkent());
                setPage(1);
              }}
            >
              {t('thisMonth')}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-from">{t('from')}</Label>
            <Input
              id="expense-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="w-auto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-to">{t('to')}</Label>
            <Input
              id="expense-to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="w-auto"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('category')}</Label>
            <Select
              value={categoryId}
              onValueChange={(v) => {
                setCategoryId(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
                {categories
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('method')}</Label>
            <Select
              value={method}
              onValueChange={(v) => {
                setMethod(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allMethods')}</SelectItem>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`methods.${m}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canSeeDeleted ? (
            <Button
              variant={showDeleted ? 'secondary' : 'outline'}
              onClick={() => {
                setShowDeleted((v) => !v);
                setPage(1);
              }}
            >
              {t('showDeleted')}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Banknote className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">{t('totalForPeriod')}</p>
            <p className="text-2xl font-bold">{query.data ? formatUZS(query.data.sum) : '—'}</p>
          </div>
        </CardContent>
      </Card>

      {query.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">{t('loadFailed')}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={query.isLoading}
          emptyText={t('empty')}
          meta={meta ? { page: meta.page, limit: meta.limit, total: meta.total } : undefined}
          onPageChange={setPage}
        />
      )}

      <ExpenseDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={categories}
        expense={editing}
      />
      <CategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        categories={categories}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? t('deleteDescription', {
                    amount: formatUZS(pendingDelete.amount),
                    category: pendingDelete.category?.name ?? '',
                    date: formatTz(pendingDelete.createdAt),
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) remove.mutate(pendingDelete.id);
              }}
            >
              {remove.isPending ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
