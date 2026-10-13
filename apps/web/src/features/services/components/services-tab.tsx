'use client';

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { History, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { servicesApi, type ServiceRow } from '../api';
import { useApiErrorToast, useCanWriteServices } from '../hooks';
import { CategorySidebar } from './category-sidebar';
import { PriceHistoryDialog } from './price-history-dialog';
import { ServiceDialog } from './service-dialog';

type ActiveFilter = 'all' | 'active' | 'inactive';

export function ServicesTab() {
  const t = useTranslations('services');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const canWrite = useCanWriteServices();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ServiceRow | null>(null);
  const [priceTarget, setPriceTarget] = useState<ServiceRow | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<ServiceRow | null>(null);

  // Debounce search input → query param.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const query = useMemo(
    () => ({
      page,
      limit: 20,
      categoryId: categoryId ?? undefined,
      search: search || undefined,
      isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
    }),
    [page, categoryId, search, activeFilter],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['services', query],
    queryFn: () => servicesApi.listServices(query),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta;

  const { data: categoriesData } = useQuery({
    queryKey: ['service-categories'],
    queryFn: () => servicesApi.listCategories(),
  });
  const categories = categoriesData?.data ?? [];

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => servicesApi.deleteService(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success(t('deactivated'));
      setDeactivateTarget(null);
    },
    onError: errorToast,
  });

  const columns = useMemo<ColumnDef<ServiceRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('table.code'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
      },
      {
        id: 'name',
        header: t('table.name'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.name.uz}</p>
            {row.original.category ? (
              <p className="text-xs text-muted-foreground">{row.original.category.name}</p>
            ) : null}
          </div>
        ),
      },
      { accessorKey: 'unit', header: t('table.unit'), cell: ({ row }) => row.original.unit },
      {
        id: 'duration',
        header: t('table.duration'),
        cell: ({ row }) => t('table.minutes', { min: row.original.durationMin }),
      },
      {
        id: 'price',
        header: t('table.price'),
        cell: ({ row }) =>
          row.original.currentPrice !== null ? (
            <span className="font-medium tabular-nums">{formatUZS(row.original.currentPrice)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'active',
        header: t('table.active'),
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            // No reactivation endpoint: the switch only deactivates (soft delete).
            disabled={!canWrite || !row.original.isActive || deactivateMutation.isPending}
            onCheckedChange={(checked) => {
              if (!checked) setDeactivateTarget(row.original);
            }}
            aria-label={t('table.active')}
          />
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canWrite ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setEditTarget(row.original);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {t('rowActions.edit')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => {
                    setPriceTarget(row.original);
                    setPriceOpen(true);
                  }}
                >
                  <History className="mr-2 h-4 w-4" />
                  {t('rowActions.priceHistory')}
                </DropdownMenuItem>
                {canWrite && row.original.isActive ? (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeactivateTarget(row.original)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('rowActions.deactivate')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [t, canWrite, deactivateMutation.isPending],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside>
        <CategorySidebar
          selectedId={categoryId}
          onSelect={(id) => {
            setCategoryId(id);
            setPage(1);
          }}
        />
      </aside>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-8"
            />
          </div>
          <Select
            value={activeFilter}
            onValueChange={(v) => {
              setActiveFilter(v as ActiveFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filter.all')}</SelectItem>
              <SelectItem value="active">{t('filter.active')}</SelectItem>
              <SelectItem value="inactive">{t('filter.inactive')}</SelectItem>
            </SelectContent>
          </Select>
          {canWrite ? (
            <Button
              type="button"
              onClick={() => {
                setEditTarget(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('newService')}
            </Button>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          data={rows}
          meta={meta}
          onPageChange={setPage}
          isLoading={isLoading}
          emptyText={t('empty.services')}
        />
      </div>

      <ServiceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={categories}
        service={editTarget}
        defaultCategoryId={categoryId}
      />

      <PriceHistoryDialog open={priceOpen} onOpenChange={setPriceOpen} service={priceTarget} />

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null);
        }}
        title={t('deactivateTitle')}
        description={t('deactivateDescription', { name: deactivateTarget?.name.uz ?? '' })}
        confirmLabel={t('rowActions.deactivate')}
        cancelLabel={t('actions.cancel')}
        destructive
        onConfirm={() => {
          if (deactivateTarget) deactivateMutation.mutate(deactivateTarget.id);
        }}
      />
    </div>
  );
}
