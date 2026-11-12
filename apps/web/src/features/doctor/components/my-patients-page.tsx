'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BedDouble, FlaskConical, Scissors, Search } from 'lucide-react';
import { formatTz } from '@/lib/dates';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissions } from '@/hooks/use-permissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { admissionsApi, type AdmissionRow } from '@/features/admissions/api';
import { surgeriesApi, type Surgery } from '@/features/surgeries/api';
import { useState } from 'react';

function matchSearch(haystack: string, q: string): boolean {
  if (!q.trim()) return true;
  return haystack.toLowerCase().includes(q.trim().toLowerCase());
}

export function MyPatientsPage() {
  const t = useTranslations('doctor.myPatients');
  const can = usePermissions();
  const userId = useAuthStore((s) => s.user?.id);
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [search, setSearch] = useState('');

  const admissions = useQuery({
    queryKey: ['doctor-my-patients', 'admissions', userId, branchId],
    enabled: Boolean(userId) && can('admissions.read'),
    queryFn: async () =>
      (
        await admissionsApi.list({
          status: 'ACTIVE',
          attendingDoctorUserId: userId,
          limit: 100,
        })
      ).data,
    refetchInterval: 20_000,
  });

  const surgeries = useQuery({
    queryKey: ['doctor-my-patients', 'surgeries', branchId],
    enabled: can('surgery.read'),
    queryFn: async () => {
      const res = await surgeriesApi.list({ bucket: 'active', limit: 100 });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 20_000,
  });

  const stayRows = useMemo(() => {
    const rows = (admissions.data ?? []) as AdmissionRow[];
    return rows.filter((row) =>
      matchSearch(
        [row.patient?.fullName, row.historyNumber, row.ward, row.bed].filter(Boolean).join(' '),
        search,
      ),
    );
  }, [admissions.data, search]);

  const surgeryRows = useMemo(() => {
    const rows = (surgeries.data ?? []) as Surgery[];
    const stayIds = new Set(stayRows.map((r) => r.id));
    return rows.filter((row) => {
      if (stayIds.has(row.admissionId)) return true; // still list under surgery if planned
      return matchSearch(
        [row.patient?.fullName, row.admission?.historyNumber, row.admission?.ward]
          .filter(Boolean)
          .join(' '),
        search,
      );
    });
  }, [surgeries.data, stayRows, search]);

  const surgeryOnly = useMemo(() => {
    const stayIds = new Set(stayRows.map((r) => r.id));
    return surgeryRows.filter((row) => !stayIds.has(row.admissionId));
  }, [surgeryRows, stayRows]);

  const loading = admissions.isLoading || surgeries.isLoading;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
        />
      </div>

      {loading ? <Skeleton className="h-64 w-full" /> : null}

      {!loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <BedDouble className="h-4 w-4 text-primary" />
                {t('inpatientTitle')}
              </CardTitle>
              <Badge variant="secondary">{stayRows.length}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {stayRows.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={BedDouble}
                    title={t('inpatientEmpty')}
                    description={t('inpatientEmptyHint')}
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {stayRows.map((row) => {
                    const surgery = surgeryRows.find((s) => s.admissionId === row.id);
                    return (
                      <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{row.patient?.fullName ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">
                            {[
                              row.historyNumber,
                              row.ward && `${t('ward')} ${row.ward}`,
                              row.bed && `№${row.bed}`,
                              formatTz(row.admittedAt, 'dd.MM.yyyy'),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          {surgery ? (
                            <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <Scissors className="h-3 w-3" />
                              {t('surgeryBadge', { date: surgery.scheduledDate })}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" asChild>
                            <Link href={`/admissions/${row.id}?from=mine&tab=reports`}>
                              <FlaskConical className="mr-1 h-3.5 w-3.5" />
                              {t('openAnalyses')}
                            </Link>
                          </Button>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/admissions/${row.id}?from=mine&tab=charges`}>
                              {t('openCharges')}
                            </Link>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scissors className="h-4 w-4 text-primary" />
                {t('surgeryTitle')}
              </CardTitle>
              <Badge variant="secondary">{surgeryRows.length}</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {surgeryRows.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Scissors}
                    title={t('surgeryEmpty')}
                    description={t('surgeryEmptyHint')}
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {surgeryRows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{row.patient?.fullName ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            row.admission?.historyNumber,
                            row.scheduledDate,
                            row.status,
                            row.admission?.ward && `${t('ward')} ${row.admission.ward}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" asChild>
                          <Link href={`/admissions/${row.admissionId}?from=mine&tab=reports`}>
                            {t('openAnalyses')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/surgeries/${row.id}`}>{t('openSurgery')}</Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {surgeryOnly.length > 0 ? (
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  {t('surgeryOnlyHint', { count: surgeryOnly.length })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
