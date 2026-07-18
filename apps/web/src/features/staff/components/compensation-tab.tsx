'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BadgeDollarSign, Plus, Trash2 } from 'lucide-react';
import { CompensationType, formatUZS } from '@avishifo/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEnumLabel } from '@/hooks/use-enum-label';
import { formatDate } from '@/lib/dates';
import { staffApi, type CompensationRuleRow } from '../api';
import {
  useApiErrorToast,
  useCompensationRules,
  usePermissions,
  useServiceCategoryOptions,
  useServiceOptions,
} from '../hooks';
import { CompensationRuleDialog } from './compensation-rule-dialog';

export function CompensationTab({ userId }: { userId: string }) {
  const t = useTranslations('staff');
  const enumLabel = useEnumLabel();
  const can = usePermissions();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = can('payroll.write');

  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<CompensationRuleRow | null>(null);

  const query = useCompensationRules(userId);
  const items = useMemo(() => query.data?.data ?? [], [query.data]);

  const categoriesQuery = useServiceCategoryOptions(true);
  const servicesQuery = useServiceOptions(true);
  const categoryName = useMemo(
    () => new Map((categoriesQuery.data?.data ?? []).map((c) => [c.id, c.name])),
    [categoriesQuery.data],
  );
  const serviceName = useMemo(
    () => new Map((servicesQuery.data?.data ?? []).map((s) => [s.id, s.name.uz])),
    [servicesQuery.data],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => staffApi.deleteRule(id),
    onSuccess: () => {
      toast.success(t('compensation.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['staff', 'compensation-rules'] });
      setDeleting(null);
    },
    onError: errorToast,
  });

  const columns = useMemo<ColumnDef<CompensationRuleRow>[]>(
    () => [
      {
        accessorKey: 'type',
        header: t('compensation.type'),
        cell: ({ row }) => (
          <Badge variant="secondary">
            {enumLabel('compensation', row.original.type)}
          </Badge>
        ),
      },
      {
        accessorKey: 'value',
        header: t('compensation.value'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-medium">
            {row.original.type === CompensationType.REVENUE_PERCENT
              ? `${row.original.value}%`
              : formatUZS(row.original.value)}
          </span>
        ),
      },
      {
        id: 'scope',
        header: t('compensation.scope'),
        cell: ({ row }) => {
          const { serviceId, serviceCategoryId } = row.original;
          if (serviceId) {
            return (
              <span>
                {t('compensation.scopeService')}: {serviceName.get(serviceId) ?? '—'}
              </span>
            );
          }
          if (serviceCategoryId) {
            return (
              <span>
                {t('compensation.scopeCategory')}: {categoryName.get(serviceCategoryId) ?? '—'}
              </span>
            );
          }
          return <span className="text-muted-foreground">{t('compensation.scopeAll')}</span>;
        },
      },
      {
        accessorKey: 'effectiveFrom',
        header: t('compensation.effectiveFrom'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDate(row.original.effectiveFrom)}</span>
        ),
      },
      {
        accessorKey: 'effectiveTo',
        header: t('compensation.effectiveTo'),
        cell: ({ row }) =>
          row.original.effectiveTo ? (
            <span className="whitespace-nowrap">{formatDate(row.original.effectiveTo)}</span>
          ) : (
            <Badge variant="outline">{t('compensation.open')}</Badge>
          ),
      },
      ...(canWrite
        ? ([
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={t('actions.delete')}
                  onClick={() => setDeleting(row.original)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ),
            },
          ] satisfies ColumnDef<CompensationRuleRow>[])
        : []),
    ],
    [t, canWrite, serviceName, categoryName, enumLabel],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canWrite ? (
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('compensation.add')}
          </Button>
        ) : null}
      </div>

      {!query.isLoading && items.length === 0 ? (
        <EmptyState
          icon={BadgeDollarSign}
          title={t('compensation.empty.title')}
          description={t('compensation.empty.description')}
          action={
            canWrite ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t('compensation.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={query.isLoading}
          emptyText={t('compensation.empty.title')}
        />
      )}

      <CompensationRuleDialog doctorUserId={userId} open={addOpen} onOpenChange={setAddOpen} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('compensation.deleteTitle')}
        description={t('compensation.deleteDescription')}
        confirmLabel={t('actions.delete')}
        cancelLabel={t('actions.cancel')}
        destructive
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
        }}
      />
    </div>
  );
}
