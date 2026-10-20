'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { localizedText } from '@/lib/localized';
import { toast } from 'sonner';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { servicesApi, type PackageRow } from '../api';
import { useApiErrorToast, useCanWriteServices } from '../hooks';
import { PackageDialog } from './package-dialog';

/** Sum of item quantities × current service prices (so'm, as number for display only). */
function itemsSum(pkg: PackageRow): number {
  return pkg.items.reduce((sum, item) => {
    if (item.service.currentPrice === null) return sum;
    return sum + Number(item.service.currentPrice) * item.quantity;
  }, 0);
}

export function PackagesTab() {
  const t = useTranslations('services');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const canWrite = useCanWriteServices();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PackageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PackageRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['service-packages'],
    queryFn: () => servicesApi.listPackages({ page: 1, limit: 100 }),
  });
  const packages = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.deletePackage(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-packages'] });
      toast.success(t('packages.deleted'));
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
            {t('packages.new')}
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t('packages.empty.title')}
          description={t('packages.empty.description')}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => {
            const sum = itemsSum(pkg);
            return (
              <Card key={pkg.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {localizedText(pkg.name, locale)}
                      </CardTitle>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{pkg.code}</p>
                    </div>
                    {!pkg.isActive ? (
                      <Badge variant="outline">{t('packages.inactive')}</Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold tabular-nums">{formatUZS(pkg.price)}</span>
                    {sum > Number(pkg.price) ? (
                      <span className="text-sm text-muted-foreground line-through tabular-nums">
                        {formatUZS(sum)}
                      </span>
                    ) : null}
                  </div>
                  <ul className="flex-1 space-y-1 text-sm text-muted-foreground">
                    {pkg.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2">
                        <span className="truncate">{localizedText(item.service.name, locale)}</span>
                        <span className="shrink-0 tabular-nums">× {item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  {canWrite ? (
                    <div className="flex justify-end gap-1 border-t pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditTarget(pkg);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        {t('rowActions.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(pkg)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {t('actions.delete')}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PackageDialog open={dialogOpen} onOpenChange={setDialogOpen} pkg={editTarget} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('packages.deleteTitle')}
        description={t('packages.deleteDescription', {
          name: localizedText(deleteTarget?.name, locale),
        })}
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
