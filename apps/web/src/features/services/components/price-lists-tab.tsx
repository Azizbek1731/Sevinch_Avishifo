'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { servicesApi, type PriceListRow } from '../api';
import { useApiErrorToast, useCanWriteServices } from '../hooks';
import { PriceListDialog } from './price-list-dialog';

export function PriceListsTab() {
  const t = useTranslations('services');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const canWrite = useCanWriteServices();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PriceListRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PriceListRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => servicesApi.listPriceLists(),
  });
  const lists = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.deletePriceList(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['price-lists'] });
      toast.success(t('priceLists.deleted'));
      setDeleteTarget(null);
    },
    onError: errorToast,
  });

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
            {t('priceLists.new')}
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={t('priceLists.empty.title')}
          description={t('priceLists.empty.description')}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <Card key={list.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{list.name}</CardTitle>
                <Badge variant={list.isActive ? 'default' : 'outline'}>
                  {list.isActive ? t('priceLists.active') : t('priceLists.inactive')}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('priceLists.itemCount', { count: list.itemCount })}
                </p>
                {canWrite ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditTarget(list);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      {t('rowActions.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleteTarget(list)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {t('actions.delete')}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PriceListDialog open={dialogOpen} onOpenChange={setDialogOpen} list={editTarget} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('priceLists.deleteTitle')}
        description={t('priceLists.deleteDescription', { name: deleteTarget?.name ?? '' })}
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
