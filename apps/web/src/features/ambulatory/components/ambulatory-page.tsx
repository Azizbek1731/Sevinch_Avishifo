'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Footprints, Percent, Plus, Search } from 'lucide-react';
import { formatUZS } from '@avishifo/shared';
import { formatTz, todayTashkent } from '@/lib/dates';
import { Link, useRouter } from '@/i18n/routing';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-permissions';
import { useAuthStore } from '@/stores/auth-store';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import { AdmitPickerDialog } from '@/features/admissions/components/admit-picker-dialog';
import { ambulatoryApi, type AmbulatoryStatus } from '../api';
import { CommissionsTab } from './commissions-tab';
import { OpenCaseDialog } from './open-case-dialog';
import { RatesDialog } from './rates-dialog';

const ALL = '__all__';

function MonthSummary() {
  const t = useTranslations('ambulatory');
  const branchId = useAuthStore((s) => s.activeBranchId);
  const today = todayTashkent();
  const filters = { from: `${today.slice(0, 8)}01`, to: today };
  const report = useQuery({
    queryKey: ['ambulatory', 'commissions', branchId, filters],
    queryFn: async () => (await ambulatoryApi.commissions(filters)).data,
    refetchInterval: 30_000,
  });
  const open = useQuery({
    queryKey: ['ambulatory', 'open-count', branchId],
    queryFn: async () => (await ambulatoryApi.list({ status: 'OPEN', limit: 1 })).meta?.total ?? 0,
    refetchInterval: 30_000,
  });
  const items = [
    {
      key: 'monthCommission',
      value: report.data ? formatUZS(report.data.totals.commission) : null,
      accent: true,
    },
    {
      key: 'monthPending',
      value: report.data ? formatUZS(report.data.totals.pendingCommission) : null,
    },
    {
      key: 'monthPatients',
      value: report.data ? String(report.data.totals.patients) : null,
    },
    { key: 'openCards', value: open.data === undefined ? null : String(open.data) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card
          key={item.key}
          className={item.accent ? 'border-primary/40 bg-gradient-to-br from-primary/10 to-transparent' : undefined}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t(`summary.${item.key}`)}</p>
            {item.value === null ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p
                className={`mt-2 text-xl font-semibold tabular-nums ${item.accent ? 'text-primary' : ''}`}
              >
                {item.value}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CasesTab({ onOpen }: { onOpen: (() => void) | null }) {
  const t = useTranslations('ambulatory');
  const router = useRouter();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const isDoctor = useAuthStore((s) => s.user?.role === 'DOCTOR');
  const [status, setStatus] = useState<AmbulatoryStatus | typeof ALL>('OPEN');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [doctorId, setDoctorId] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = {
    status: status === ALL ? undefined : status,
    search: debouncedSearch || undefined,
    doctorUserId: !isDoctor && doctorId !== ALL ? doctorId : undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: !isDoctor && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });
  const doctorOptions = useMemo(
    () => (doctors.data ?? []).filter((doctor) => !isUziSpecialty(doctor.specialty)),
    [doctors.data],
  );

  const query = useQuery({
    queryKey: ['ambulatory', 'list', branchId, filters],
    queryFn: async () => (await ambulatoryApi.list({ ...filters, limit: 100 })).data,
    refetchInterval: 20_000,
  });
  const rows = query.data ?? [];
  const filtered = Boolean(search || doctorId !== ALL || from || to || status !== 'OPEN');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['OPEN', 'CLOSED', ALL] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {s === ALL ? t('filters.allStatuses') : t(`status.${s}`)}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        {!isDoctor ? (
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={t('fields.doctor')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.allDoctors')}</SelectItem>
              {doctorOptions.map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-40"
            aria-label={t('filters.from')}
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-40"
            aria-label={t('filters.to')}
          />
        </div>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus('OPEN');
              setSearch('');
              setDoctorId(ALL);
              setFrom('');
              setTo('');
            }}
          >
            {t('filters.clear')}
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Footprints}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                onOpen ? (
                  <Button size="sm" onClick={onOpen}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('open')}
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.number')}</TableHead>
                  <TableHead>{t('table.patient')}</TableHead>
                  {!isDoctor ? <TableHead>{t('table.doctor')}</TableHead> : null}
                  <TableHead>{t('table.opened')}</TableHead>
                  <TableHead className="text-center">{t('table.referrals')}</TableHead>
                  <TableHead className="text-right">{t('table.labPaid')}</TableHead>
                  <TableHead className="text-right">{t('table.commission')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/ambulatory/${row.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/ambulatory/${row.id}`}
                        className="font-mono text-xs hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.number}
                      </Link>
                      {row.status === 'CLOSED' ? (
                        <Badge variant="outline" className="ml-2">
                          {t('status.CLOSED')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.patient?.fullName ?? '—'}</p>
                      {row.complaint || row.diagnosis ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {row.diagnosis ?? row.complaint}
                        </p>
                      ) : null}
                    </TableCell>
                    {!isDoctor ? (
                      <TableCell className="text-muted-foreground">{row.doctorName}</TableCell>
                    ) : null}
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTz(row.openedAt)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-1.5">
                        <Badge variant="secondary">
                          {t('table.labCount', { count: row.labOrders ?? 0 })}
                        </Badge>
                        <Badge variant="outline">
                          {t('table.uziCount', { count: row.uziOrders ?? 0 })}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUZS(row.paidAmount ?? '0')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold text-primary">
                        {formatUZS(row.commission ?? '0')}
                      </span>
                      {row.pendingCommission && Number(row.pendingCommission) > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          +{formatUZS(row.pendingCommission)} {t('table.pending')}
                        </p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Walk-in patients of one doctor and the doctor's share of their paid lab work. */
export function AmbulatoryPage() {
  const t = useTranslations('ambulatory');
  const can = usePermissions();
  const searchParams = useSearchParams();
  const isDoctor = useAuthStore((s) => s.user?.role === 'DOCTOR');
  const [tab, setTab] = useState(
    searchParams.get('tab') === 'commissions' ? 'commissions' : 'cases',
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [opening, setOpening] = useState<{ id: string; fullName: string } | null>(null);
  const canWrite = can('ambulatory.write');

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={isDoctor ? t('descriptionDoctor') : t('description')}
      >
        <div className="flex flex-wrap gap-2">
          {can('ambulatory.rates.write') ? (
            <Button variant="outline" onClick={() => setRatesOpen(true)}>
              <Percent className="mr-2 h-4 w-4" />
              {t('rates.button')}
            </Button>
          ) : null}
          {canWrite ? (
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('open')}
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <MonthSummary />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="cases">{t('tabs.cases')}</TabsTrigger>
          <TabsTrigger value="commissions">
            {isDoctor ? t('tabs.myCommission') : t('tabs.commissions')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cases" className="mt-4">
          <CasesTab onOpen={canWrite ? () => setPickerOpen(true) : null} />
        </TabsContent>
        <TabsContent value="commissions" className="mt-4">
          <CommissionsTab />
        </TabsContent>
      </Tabs>

      <AdmitPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(patient) => setOpening(patient)}
        title={t('pickPatientTitle')}
        description={t('pickPatientDescription')}
      />
      {opening ? (
        <OpenCaseDialog
          open
          onOpenChange={(value) => {
            if (!value) setOpening(null);
          }}
          patientId={opening.id}
          patientName={opening.fullName}
        />
      ) : null}
      {can('ambulatory.rates.write') ? (
        <RatesDialog open={ratesOpen} onOpenChange={setRatesOpen} />
      ) : null}
    </div>
  );
}
