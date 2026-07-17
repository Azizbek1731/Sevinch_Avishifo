'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { DiscountType, formatUZS } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { servicesApi, type DiscountRuleRow } from '../api';
import { useApiErrorToast, useCanWriteServices } from '../hooks';
import { DiscountRuleDialog } from './discount-rule-dialog';

export function DiscountsTab() {
  const t = useTranslations('services');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const canWrite = useCanWriteServices();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DiscountRuleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DiscountRuleRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['discount-rules'],
    queryFn: () => servicesApi.listDiscountRules({ page: 1, limit: 100 }),
  });
  const rules = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.deleteDiscountRule(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['discount-rules'] });
      toast.success(t('discounts.deleted'));
      setDeleteTarget(null);
    },
    onError: errorToast,
  });

  const columns = useMemo<ColumnDef<DiscountRuleRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('discounts.table.name'),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: 'type',
        header: t('discounts.table.type'),
        cell: ({ row }) => t(`discounts.types.${row.original.type}`),
      },
      {
        id: 'value',
        header: t('discounts.table.value'),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.type === DiscountType.PERCENT
              ? `${row.original.value}%`
              : formatUZS(row.original.value)}
          </span>
        ),
      },
      {
        id: 'patientTag',
        header: t('discounts.table.patientTag'),
        cell: ({ row }) =>
          row.original.patientTag ? (
            <Badge variant="secondary">{row.original.patientTag}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'promoCode',
        header: t('discounts.table.promoCode'),
        cell: ({ row }) =>
          row.original.promoCode ? (
            <span className="font-mono text-xs">{row.original.promoCode}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'active',
        header: t('discounts.table.active'),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'outline'}>
            {row.original.isActive ? t('discounts.active') : t('discounts.inactive')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          canWrite ? (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditTarget(row.original);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {t('rowActions.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(row.original)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('actions.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    [t, canWrite],
  );

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setEditTarget(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('discounts.new')}
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={rules}
        isLoading={isLoading}
        emptyText={t('discounts.empty')}
      />

      <DiscountRuleDialog open={dialogOpen} onOpenChange={setDialogOpen} rule={editTarget} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('discounts.deleteTitle')}
        description={t('discounts.deleteDescription', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('actions.delete')}
        cancelLabel={t('actions.cancel')}
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
