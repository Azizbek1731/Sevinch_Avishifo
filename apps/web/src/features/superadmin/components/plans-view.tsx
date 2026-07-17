'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Tags } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { superadminApi, type PlanRow } from '../api';
import { usePermission } from '../hooks';
import { PlanDialog } from './plan-dialog';

export function PlansView() {
  const t = useTranslations('superadmin');
  const can = usePermission();
  const canWrite = can('platform.plans.write');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);

  const { data: plans, isLoading } = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => superadminApi.listPlans(),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (plan: PlanRow) => {
    setEditing(plan);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('plans.title')} description={t('plans.description')}>
        {canWrite ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('plans.create')}
          </Button>
        ) : null}
      </PageHeader>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : !plans || plans.length === 0 ? (
        <EmptyState
          icon={Tags}
          title={t('plans.empty.title')}
          description={t('plans.empty.description')}
          action={
            canWrite ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                {t('plans.create')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className={plan.isActive ? undefined : 'opacity-60'}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">{plan.code}</p>
                </div>
                {!plan.isActive ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('plans.inactive')}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-bold">
                  {formatUZS(plan.priceMonthly)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {t('plans.perMonth')}
                  </span>
                </p>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    {t('plans.maxBranches')}: <span className="font-medium text-foreground">{plan.maxBranches}</span>
                  </p>
                  <p>
                    {t('plans.maxUsers')}: <span className="font-medium text-foreground">{plan.maxUsers}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {plan.modules.map((m) => (
                    <Badge key={m} variant="secondary">
                      {m}
                    </Badge>
                  ))}
                </div>
                {canWrite ? (
                  <Button variant="outline" size="sm" onClick={() => openEdit(plan)}>
                    <Pencil className="h-4 w-4" />
                    {t('plans.edit')}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PlanDialog open={dialogOpen} onOpenChange={setDialogOpen} plan={editing} />
    </div>
  );
}
