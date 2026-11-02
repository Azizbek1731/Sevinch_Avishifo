'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Activity, FileDown, FlaskConical, Stethoscope, type LucideIcon } from 'lucide-react';
import { LabOrderStatus } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { Link } from '@/i18n/routing';
import { usePermissions } from '@/hooks/use-permissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { clinicalOrdersApi, type ClinicalOrder } from '@/features/clinical-orders/api';
import { patientsApi, type PatientVisit } from '@/features/patients/api';

interface PatientLabOrder {
  id: string;
  orderNumber: string;
  status: LabOrderStatus;
  itemCount: number;
  createdAt: string | null;
  canWork: boolean;
}

const READY_LAB: readonly LabOrderStatus[] = [LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED];

function inStayWindow(
  iso: string | null | undefined,
  admittedAt: string,
  dischargedAt: string | null,
): boolean {
  if (!iso) return true;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return true;
  if (at < new Date(admittedAt).getTime() - 12 * 60 * 60 * 1000) return false;
  if (dischargedAt && at > new Date(dischargedAt).getTime() + 12 * 60 * 60 * 1000) return false;
  return true;
}

function serviceTitles(
  services: ClinicalOrder['services'],
  locale: string,
): string {
  return services
    .map((service) =>
      typeof service.title === 'string'
        ? service.title
        : localizedText(service.title, locale),
    )
    .filter(Boolean)
    .join(', ');
}

/** Stay-scoped summaries: doctors, laboratory, ultrasound for this patient. */
export function AdmissionReportsPanel({
  patientId,
  admittedAt,
  dischargedAt,
}: {
  patientId: string;
  admittedAt: string;
  dischargedAt: string | null;
}) {
  const t = useTranslations('admissions.reports');
  const tLab = useTranslations('lab');
  const tClinical = useTranslations('doctor.clinical');
  const locale = useLocale();
  const can = usePermissions();
  const [downloading, setDownloading] = useState<string | null>(null);

  const visits = useQuery({
    queryKey: ['admission-reports', 'visits', patientId],
    queryFn: async () => (await patientsApi.visits(patientId, { page: 1, limit: 100 })).data,
    enabled: can('visits.read'),
  });

  const consultations = useQuery({
    queryKey: ['admission-reports', 'consultation', patientId],
    queryFn: async () =>
      (
        await clinicalOrdersApi.list({
          patientId,
          kind: 'CONSULTATION',
          page: 1,
          limit: 100,
        })
      ).data,
    enabled: can('patients.read'),
  });

  const ultrasound = useQuery({
    queryKey: ['admission-reports', 'ultrasound', patientId],
    queryFn: async () =>
      (
        await clinicalOrdersApi.list({
          patientId,
          kind: 'ULTRASOUND',
          page: 1,
          limit: 100,
        })
      ).data,
    enabled: can('patients.read'),
  });

  const labOrders = useQuery({
    queryKey: ['admission-reports', 'lab', patientId],
    queryFn: async () =>
      (
        await api.get<PatientLabOrder[]>('/lab-orders', {
          patientId,
          page: 1,
          limit: 100,
          includeUnpaid: true,
        })
      ).data,
    enabled: can('lab.orders.read'),
  });

  const stayVisits = useMemo(
    () =>
      (visits.data ?? []).filter((visit) =>
        inStayWindow(visit.startedAt ?? visit.completedAt, admittedAt, dischargedAt),
      ),
    [visits.data, admittedAt, dischargedAt],
  );

  const stayConsultations = useMemo(
    () =>
      (consultations.data ?? []).filter((order) =>
        inStayWindow(order.createdAt, admittedAt, dischargedAt),
      ),
    [consultations.data, admittedAt, dischargedAt],
  );

  const stayUzi = useMemo(
    () =>
      (ultrasound.data ?? []).filter((order) =>
        inStayWindow(order.createdAt, admittedAt, dischargedAt),
      ),
    [ultrasound.data, admittedAt, dischargedAt],
  );

  const stayLab = useMemo(
    () =>
      (labOrders.data ?? []).filter((order) =>
        inStayWindow(order.createdAt, admittedAt, dischargedAt),
      ),
    [labOrders.data, admittedAt, dischargedAt],
  );

  const loading =
    visits.isLoading || consultations.isLoading || ultrasound.isLoading || labOrders.isLoading;

  const downloadLab = async (order: PatientLabOrder) => {
    setDownloading(order.id);
    try {
      const blob = await api.get<Blob>(`/lab-orders/${order.id}/pdf`, { locale });
      const url = URL.createObjectURL(blob.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `natija-${order.orderNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('labDownloadFailed'));
    } finally {
      setDownloading(null);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>

      <ReportSection
        icon={Stethoscope}
        title={t('doctors')}
        empty={t('doctorsEmpty')}
        count={stayConsultations.length + stayVisits.filter((v) => v.kind === 'CONSULTATION').length}
      >
        {stayConsultations.map((order) => (
          <ReportRow
            key={order.id}
            title={order.doctor.fullName}
            meta={[
              formatTz(order.createdAt),
              serviceTitles(order.services, locale) || tClinical('services'),
            ].join(' · ')}
            status={order.status}
            href={order.visitId ? `/doctor/visits/${order.visitId}` : undefined}
            openLabel={t('openVisit')}
          />
        ))}
        {stayVisits
          .filter(
            (visit) =>
              visit.kind === 'CONSULTATION' &&
              !stayConsultations.some((order) => order.visitId === visit.id),
          )
          .map((visit) => (
            <VisitRow key={visit.id} visit={visit} openLabel={t('openVisit')} untitled={t('visit')} />
          ))}
      </ReportSection>

      <ReportSection
        icon={FlaskConical}
        title={t('lab')}
        empty={t('labEmpty')}
        count={stayLab.length}
      >
        {stayLab.map((order) => (
          <li
            key={order.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {tLab('order')} #{order.orderNumber}
              </p>
              <p className="text-xs text-muted-foreground">
                {[order.createdAt ? formatTz(order.createdAt) : null, `${order.itemCount} ${t('tests')}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={order.status} />
              {READY_LAB.includes(order.status) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloading === order.id}
                  onClick={() => void downloadLab(order)}
                >
                  <FileDown className="mr-1 h-4 w-4" />
                  {t('pdf')}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/lab/${order.id}`}>{t('openLab')}</Link>
              </Button>
            </div>
          </li>
        ))}
      </ReportSection>

      <ReportSection
        icon={Activity}
        title={t('uzi')}
        empty={t('uziEmpty')}
        count={stayUzi.length + stayVisits.filter((v) => v.kind === 'ULTRASOUND').length}
      >
        {stayUzi.map((order) => (
          <ReportRow
            key={order.id}
            title={order.doctor.fullName}
            meta={[
              formatTz(order.createdAt),
              serviceTitles(order.services, locale) || tClinical('services'),
            ]
              .filter(Boolean)
              .join(' · ')}
            status={order.status}
            href={order.visitId ? `/doctor/visits/${order.visitId}` : '/uzi'}
            openLabel={order.visitId ? t('openVisit') : t('openUzi')}
          />
        ))}
        {stayVisits
          .filter(
            (visit) =>
              visit.kind === 'ULTRASOUND' &&
              !stayUzi.some((order) => order.visitId === visit.id),
          )
          .map((visit) => (
            <VisitRow key={visit.id} visit={visit} openLabel={t('openVisit')} untitled={t('visit')} />
          ))}
      </ReportSection>
    </div>
  );
}

function ReportSection({
  icon: Icon,
  title,
  empty,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <Badge variant="outline">{count}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        {count === 0 ? (
          <div className="p-6">
            <EmptyState title={empty} />
          </div>
        ) : (
          <ul className="divide-y">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReportRow({
  title,
  meta,
  status,
  href,
  openLabel,
}: {
  title: string;
  meta: string;
  status: string;
  href?: string;
  openLabel: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
        {href ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href={href}>{openLabel}</Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function VisitRow({
  visit,
  openLabel,
  untitled,
}: {
  visit: PatientVisit;
  openLabel: string;
  untitled: string;
}) {
  return (
    <ReportRow
      title={visit.doctor.fullName}
      meta={[
        visit.startedAt ? formatTz(visit.startedAt) : null,
        visit.reportTitle || untitled,
      ]
        .filter(Boolean)
        .join(' · ')}
      status={visit.status}
      href={`/doctor/visits/${visit.id}`}
      openLabel={openLabel}
    />
  );
}
