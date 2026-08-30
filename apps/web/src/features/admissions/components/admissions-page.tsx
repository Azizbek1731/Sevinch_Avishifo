'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { BedDouble, Plus } from 'lucide-react';
import { formatTz } from '@/lib/dates';
import { Link, useRouter } from '@/i18n/routing';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermissions } from '@/hooks/use-permissions';
import { admissionsApi } from '../api';
import { AdmitDialog } from './admit-dialog';
import { AdmitPickerDialog } from './admit-picker-dialog';

/** The ward: who is in a bed right now, and who has been discharged. */
export function AdmissionsPage() {
  const t = useTranslations('admissions');
  const can = usePermissions();
  const router = useRouter();
  const [status, setStatus] = useState<'ACTIVE' | 'DISCHARGED'>('ACTIVE');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [admitting, setAdmitting] = useState<{ id: string; fullName: string } | null>(null);

  const query = useQuery({
    queryKey: ['admissions', status],
    queryFn: async () => (await admissionsApi.list({ status, limit: 100 })).data,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')}>
        {can('admissions.write') ? (
          <Button onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('admit')}
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex gap-2">
        {(['ACTIVE', 'DISCHARGED'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {t(`status.${s}`)}
          </Button>
        ))}
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
                    // The whole row opens the stay. Only the history number used
                    // to be a link, so clicking the patient's name — the obvious
                    // target — did nothing, and the discharge button on the
                    // detail page was never found.
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
