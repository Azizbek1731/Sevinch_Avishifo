'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BedDouble, Download, Loader2, Plus, Search } from 'lucide-react';
import { formatTz, todayTashkent } from '@/lib/dates';
import { Link, useRouter } from '@/i18n/routing';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useApiErrorToast } from '@/features/services/hooks';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { admissionsApi } from '../api';
import { AdmitDialog } from './admit-dialog';
import { AdmitPickerDialog } from './admit-picker-dialog';

const ALL = '__all__';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The ward: who is in a bed right now, and who has been discharged. */
export function AdmissionsPage() {
  const t = useTranslations('admissions');
  const can = usePermissions();
  const router = useRouter();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [status, setStatus] = useState<'ACTIVE' | 'DISCHARGED' | typeof ALL>(ALL);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [ward, setWard] = useState('');
  const [doctorId, setDoctorId] = useState(ALL);
  const [admittedFrom, setAdmittedFrom] = useState('');
  const [admittedTo, setAdmittedTo] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [admitting, setAdmitting] = useState<{ id: string; fullName: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = {
    status: status === ALL ? undefined : status,
    search: debouncedSearch || undefined,
    department: department.trim() || undefined,
    ward: ward.trim() || undefined,
    attendingDoctorUserId: doctorId === ALL ? undefined : doctorId,
    admittedFrom: admittedFrom || undefined,
    admittedTo: admittedTo || undefined,
  };

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });

  const query = useQuery({
    queryKey: ['admissions', filters],
    queryFn: async () => (await admissionsApi.list({ ...filters, limit: 100 })).data,
  });

  const exportXlsx = useMutation({
    mutationFn: () => admissionsApi.exportXlsx(filters),
    onSuccess: (blob) => {
      const stamp = todayTashkent();
      downloadBlob(blob, `statsionar_${stamp}.xlsx`);
      toast.success(t('export.success'));
    },
    onError: errorToast,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')}>
        <div className="flex flex-wrap gap-2">
          {can('admissions.export') ? (
            <Button
              type="button"
              variant="outline"
              disabled={exportXlsx.isPending}
              onClick={() => exportXlsx.mutate()}
            >
              {exportXlsx.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t('export.xlsx')}
            </Button>
          ) : null}
          {can('admissions.write') ? (
            <Button onClick={() => setPickerOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('admit')}
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {([ALL, 'ACTIVE', 'DISCHARGED'] as const).map((s) => (
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <Input
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder={t('fields.department')}
          className="w-40"
        />
        <Input
          value={ward}
          onChange={(e) => setWard(e.target.value)}
          placeholder={t('fields.roomNumber')}
          className="w-32"
        />
        <Select value={doctorId} onValueChange={setDoctorId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t('fields.attendingDoctor')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allDoctors')}</SelectItem>
            {(doctors.data ?? []).map((doctor) => (
              <SelectItem key={doctor.id} value={doctor.id}>
                {doctor.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={admittedFrom}
            onChange={(e) => setAdmittedFrom(e.target.value)}
            className="w-40"
            aria-label={t('filters.from')}
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            value={admittedTo}
            onChange={(e) => setAdmittedTo(e.target.value)}
            className="w-40"
            aria-label={t('filters.to')}
          />
        </div>
        {search || department || ward || doctorId !== ALL || admittedFrom || admittedTo || status !== ALL ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus(ALL);
              setSearch('');
              setDepartment('');
              setWard('');
              setDoctorId(ALL);
              setAdmittedFrom('');
              setAdmittedTo('');
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
              icon={BedDouble}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                can('admissions.write') ? (
                  <Button size="sm" onClick={() => setPickerOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('admit')}
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.history')}</TableHead>
                  <TableHead>{t('table.patient')}</TableHead>
                  <TableHead>{t('table.doctor')}</TableHead>
                  <TableHead>{t('table.place')}</TableHead>
                  <TableHead>{t('table.admitted')}</TableHead>
                  <TableHead>{t('table.days')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const from = new Date(a.admittedAt).getTime();
                  const to = a.dischargedAt ? new Date(a.dischargedAt).getTime() : Date.now();
                  // Bed-days as the ward counts them: the day of admission counts.
                  const days = Math.max(1, Math.ceil((to - from) / 86_400_000));
                  return (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admissions/${a.id}`)}
                    >
                      <TableCell>
                        <Link
                          href={`/admissions/${a.id}`}
                          className="font-mono text-xs hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.historyNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{a.patient?.fullName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.attendingDoctor?.fullName ?? a.attendingDoctorName ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {[a.department, a.ward && `${t('fields.ward')} ${a.ward}`, a.bed && `№${a.bed}`]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTz(a.admittedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{days}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AdmitPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(p) => setAdmitting(p)}
      />
      {admitting ? (
        <AdmitDialog
          open
          onOpenChange={(v) => {
            if (!v) setAdmitting(null);
          }}
          patientId={admitting.id}
          patientName={admitting.fullName}
        />
      ) : null}
    </div>
  );
}
