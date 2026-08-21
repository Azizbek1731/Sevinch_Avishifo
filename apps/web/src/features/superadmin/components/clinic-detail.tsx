'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Building2, LogIn, Pause, Play } from 'lucide-react';
import { ClinicStatus, formatUZS, type UpdateSubscriptionInput } from '@avishifo/shared';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api-client';
import { useAuthStore, type MeResponse } from '@/stores/auth-store';
import { formatDate, formatTz } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { superadminApi, FEATURE_FLAG_KEYS, type FeatureFlagKey } from '../api';
import { useApiErrorToast, usePermission } from '../hooks';

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function ClinicDetailView({ clinicId }: { clinicId: string }) {
  const t = useTranslations('superadmin');
  const can = usePermission();
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [planId, setPlanId] = useState<string>('');
  const [endsAtDate, setEndsAtDate] = useState<string>('');
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);

  const clinicQuery = useQuery({
    queryKey: ['platform', 'clinics', clinicId],
    queryFn: () => superadminApi.getClinic(clinicId),
  });
  const plansQuery = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => superadminApi.listPlans(),
    enabled: can('platform.plans.write') || can('platform.clinics.write'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform', 'clinics'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: ClinicStatus) => superadminApi.updateClinicStatus(clinicId, { status }),
    onSuccess: () => {
      invalidate();
      toast.success(t('detail.statusUpdated'));
    },
    onError: errorToast,
  });

  const assignPlanMutation = useMutation({
    mutationFn: (id: string) => superadminApi.assignPlan(clinicId, { planId: id }),
    onSuccess: () => {
      invalidate();
      toast.success(t('detail.plan.assigned'));
    },
    onError: errorToast,
  });

  /** Extend/shorten in place — never resets startsAt (unlike assignPlan). */
  const extendMutation = useMutation({
    mutationFn: (input: UpdateSubscriptionInput) =>
      superadminApi.updateSubscription(clinicId, input),
    onSuccess: () => {
      invalidate();
      toast.success(t('detail.plan.extended'));
    },
    onError: errorToast,
  });

  const flagMutation = useMutation({
    mutationFn: (input: { key: FeatureFlagKey; enabled: boolean }) =>
      superadminApi.setFeatureFlag(clinicId, input),
    onSuccess: () => {
      invalidate();
      toast.success(t('detail.flags.updated'));
    },
    onError: errorToast,
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await superadminApi.impersonate(clinicId);
      // The token lives in memory only — the store persists nothing but the
      // branch selection. The old code set it and then did a FULL page load,
      // which wiped it; AuthBootstrap then refreshed from the super-admin's own
      // cookie and put the super-admin straight back. The button looked dead
      // because the impersonation token was thrown away before it was used.
      const store = useAuthStore.getState();
      store.setAccessToken(res.accessToken);
      // Loaded with the new token, so the panel opens as the clinic owner
      // rather than rendering the super-admin's identity against it.
      const me = await api.get<MeResponse>('/auth/me');
      store.setSession({ ...me.data, accessToken: res.accessToken });
      return res;
    },
    onSuccess: () => {
      // Platform answers were fetched as the super-admin; none of them belong
      // to the clinic being entered.
      queryClient.clear();
      toast.warning(t('detail.impersonationMode'));
      // Client-side navigation: a full load would destroy the session we just
      // built, which is the whole bug. Reloading the page is also how you leave
      // impersonation — the refresh cookie restores the super-admin.
      router.push('/dashboard');
    },
    onError: errorToast,
  });

  if (clinicQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  const clinic = clinicQuery.data;
  if (!clinic) {
    return (
      <EmptyState
        icon={Building2}
        title={t('detail.notFound')}
        action={
          <Button variant="outline" asChild>
            <Link href="/platform/clinics">
              <ArrowLeft className="h-4 w-4" />
              {t('detail.backToList')}
            </Link>
          </Button>
        }
      />
    );
  }

  const canWrite = can('platform.clinics.write');
  const suspended = clinic.status === ClinicStatus.SUSPENDED;
  const nextStatus = suspended ? ClinicStatus.ACTIVE : ClinicStatus.SUSPENDED;
  const flagEnabled = (key: string) =>
    clinic.featureFlags.find((f) => f.key === key)?.enabled ?? false;

  return (
    <div className="space-y-4">
      <PageHeader title={clinic.name} description={clinic.legalName ?? undefined}>
        <Button variant="outline" asChild>
          <Link href="/platform/clinics">
            <ArrowLeft className="h-4 w-4" />
            {t('detail.backToList')}
          </Link>
        </Button>
        {can('platform.impersonate') ? (
          <Button
            variant="secondary"
            onClick={() => impersonateMutation.mutate()}
            disabled={impersonateMutation.isPending}
          >
            <LogIn className="h-4 w-4" />
            {t('detail.actions.impersonate')}
          </Button>
        ) : null}
        {canWrite ? (
          <Button
            variant={suspended ? 'default' : 'destructive'}
            onClick={() => setStatusConfirmOpen(true)}
            disabled={statusMutation.isPending}
          >
            {suspended ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {suspended ? t('detail.actions.activate') : t('detail.actions.suspend')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.info')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label={t('clinics.columns.status')}
              value={<StatusBadge status={clinic.status} group="clinic" />}
            />
            <InfoRow label={t('clinics.createDialog.phone')} value={clinic.phone ?? '—'} />
            <InfoRow label={t('clinics.createDialog.email')} value={clinic.email ?? '—'} />
            <InfoRow label={t('detail.createdAt')} value={formatDate(clinic.createdAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detail.plan.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InfoRow
              label={t('detail.plan.current')}
              value={
                clinic.subscription
                  ? `${clinic.subscription.plan.name} · ${formatUZS(clinic.subscription.plan.priceMonthly)}`
                  : t('clinics.noPlan')
              }
            />
            {clinic.subscription ? (
              <>
                <InfoRow
                  label={t('clinics.columns.status')}
                  value={<StatusBadge status={clinic.subscription.status} group="subscription" />}
                />
                <InfoRow
                  label={t('detail.plan.endsAt')}
                  value={
                    clinic.subscription.endsAt ? (
                      <span className={clinic.subscription.isExpired ? 'text-destructive' : ''}>
                        {formatTz(clinic.subscription.endsAt, 'dd.MM.yyyy')}
                        {clinic.subscription.isExpired
                          ? ` · ${t('clinics.expired')}`
                          : clinic.subscription.daysLeft !== null
                            ? ` · ${t('clinics.daysLeft', { days: clinic.subscription.daysLeft })}`
                            : ''}
                      </span>
                    ) : (
                      t('detail.plan.perpetual')
                    )
                  }
                />
              </>
            ) : null}

            {canWrite && clinic.subscription ? (
              <div className="space-y-2 rounded-md border border-dashed p-3">
                <Label>{t('detail.plan.extendTitle')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {[7, 14, 30].map((days) => (
                    <Button
                      key={days}
                      size="sm"
                      variant="outline"
                      disabled={extendMutation.isPending}
                      onClick={() => extendMutation.mutate({ extendDays: days })}
                    >
                      +{days} {t('detail.plan.days')}
                    </Button>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      className="w-40"
                      value={endsAtDate}
                      onChange={(e) => setEndsAtDate(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!endsAtDate || extendMutation.isPending}
                      onClick={() =>
                        extendMutation.mutate({
                          // End of the chosen day, so the clinic keeps that day.
                          endsAt: new Date(`${endsAtDate}T23:59:59.000Z`).toISOString(),
                        })
                      }
                    >
                      {t('detail.plan.setDate')}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t('detail.plan.extendHint')}</p>
              </div>
            ) : null}

            {canWrite ? (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <Label>{t('detail.plan.select')}</Label>
                  <Select value={planId || undefined} onValueChange={setPlanId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('detail.plan.select')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(plansQuery.data ?? [])
                        .filter((p) => p.isActive)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} · {formatUZS(p.priceMonthly)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => assignPlanMutation.mutate(planId)}
                  disabled={!planId || assignPlanMutation.isPending}
                >
                  {t('detail.plan.assign')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('detail.flags.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURE_FLAG_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <span className="text-sm font-medium">{t(`detail.flags.${key}` as never)}</span>
                  <Switch
                    checked={flagEnabled(key)}
                    disabled={!canWrite || flagMutation.isPending}
                    onCheckedChange={(enabled) => flagMutation.mutate({ key, enabled })}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={statusConfirmOpen}
        onOpenChange={setStatusConfirmOpen}
        title={suspended ? t('detail.activateConfirm.title') : t('detail.suspendConfirm.title')}
        description={
          suspended
            ? t('detail.activateConfirm.description', { name: clinic.name })
            : t('detail.suspendConfirm.description', { name: clinic.name })
        }
        confirmLabel={suspended ? t('detail.actions.activate') : t('detail.actions.suspend')}
        cancelLabel={t('actions.cancel')}
        destructive={!suspended}
        onConfirm={() => statusMutation.mutate(nextStatus)}
      />
    </div>
  );
}
