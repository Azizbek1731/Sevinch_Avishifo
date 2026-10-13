'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRight, FileDown, FlaskConical } from 'lucide-react';
import { LabOrderStatus } from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatTz } from '@/lib/dates';
import { api } from '@/lib/api-client';
import { usePermissions } from '@/hooks/use-permissions';
import { useSocketEvent } from '@/hooks/use-socket';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { hasUnpaidLabWork } from '@/features/lab/lib';
import { StatusBadge } from '@/components/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PatientLabOrder {
  id: string;
  orderNumber: string;
  status: LabOrderStatus;
  itemCount: number;
  createdAt: string | null;
  canWork: boolean;
}

/** A ready result exists once the order has passed approval. */
const READY: readonly LabOrderStatus[] = [LabOrderStatus.APPROVED, LabOrderStatus.DELIVERED];

/**
 * Laborator ma'lumotlar — the patient's lab history in their own card.
 *
 * The order appears here the moment the service is sold, so reception can answer
 * "qachon tayyor bo'ladi?" without leaving the card; once the laboratory approves
 * it, the same row grows a PDF button — the identical file the patient gets in
 * the portal and the Telegram bot.
 */
export function PatientLabTab({ patientId }: { patientId: string }) {
  const t = useTranslations('patients');
  const tLab = useTranslations('lab');
  const can = usePermissions();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ['patients', 'lab-orders', patientId, page],
    queryFn: async () =>
      api.get<PatientLabOrder[]>('/lab-orders', {
        patientId,
        page,
        limit: 20,
        includeUnpaid: true,
      }),
    enabled: can('lab.orders.read'),
    refetchInterval: 30_000,
  });
  useSocketEvent('lab.order.updated', (event) => {
    if (event.order.patientId === patientId)
      void queryClient.invalidateQueries({ queryKey: ['patients', 'lab-orders', patientId] });
  });

  const download = async (order: PatientLabOrder): Promise<void> => {
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
      toast.error(t('lab.downloadFailed'));
    } finally {
      setDownloading(null);
    }
  };

  if (orders.isLoading) return <Skeleton className="h-48 w-full" />;

  const rows = orders.data?.data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8">
          <EmptyState
            icon={FlaskConical}
            title={t('lab.emptyTitle')}
            description={t('lab.emptyDescription')}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('lab.colOrder')}</TableHead>
              <TableHead>{t('lab.colDate')}</TableHead>
              <TableHead>{t('lab.colTests')}</TableHead>
              <TableHead>{t('lab.colStatus')}</TableHead>
              <TableHead className="text-right">{t('lab.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {o.createdAt ? formatTz(o.createdAt) : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{o.itemCount}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={o.status}
                    label={
                      hasUnpaidLabWork(o)
                        ? tLab('paymentWaiting')
                        : tLab(`status.${o.status}` as never)
                    }
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {READY.includes(o.status) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={downloading === o.id}
                        onClick={() => void download(o)}
                      >
                        <FileDown className="mr-1 h-4 w-4" />
                        PDF
                      </Button>
                    ) : null}
                    {can('lab.orders.read') ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/lab/${o.id}`}>
                          {t('lab.open')}
                          <ArrowRight className="ml-1 h-4 w-4" />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(orders.data?.meta?.total ?? 0) > 20 ? (
          <div className="flex items-center justify-end gap-3 border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
            >
              {tLab('previousPage')}
            </Button>
            <span className="text-sm">
              {page} / {Math.ceil((orders.data?.meta?.total ?? 0) / 20)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * 20 >= (orders.data?.meta?.total ?? 0)}
              onClick={() => setPage((current) => current + 1)}
            >
              {tLab('nextPage')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
