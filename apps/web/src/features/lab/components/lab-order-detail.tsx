'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  FileDown,
  FlaskConical,
  Play,
  Printer,
  Syringe,
} from 'lucide-react';
import {
  Gender,
  LabOrderStatus,
  PhysiologicalState,
  formatPhone,
  formatUZS,
} from '@avishifo/shared';
import { Link } from '@/i18n/routing';
import { formatDate, formatTz } from '@/lib/dates';
import { useSocketEvent } from '@/hooks/use-socket';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import {
  useApproveOrder,
  useDeliverOrder,
  useHasPermission,
  useLabOrder,
  useSetOrderContext,
  useUpdateOrderStatus,
} from '../hooks';
import { hasUnpaidLabWork } from '../lib';
import { OrderItemCard } from './order-item-card';
import { OrderAttachments } from './order-attachments';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

const LOCKED_STATUSES: readonly LabOrderStatus[] = [
  LabOrderStatus.APPROVED,
  LabOrderStatus.DELIVERED,
  LabOrderStatus.CANCELLED,
];

export function LabOrderDetail({ id }: { id: string }) {
  const t = useTranslations('lab');
  const tc = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();

  const canWrite = useHasPermission('lab.orders.write');
  const canEnterResults = useHasPermission('lab.results.write');
  const canApprove = useHasPermission('lab.results.approve');
  const canReadInvoice = useHasPermission('invoices.read');

  const orderQuery = useLabOrder(id);
  const updateStatus = useUpdateOrderStatus();
  const approve = useApproveOrder();
  const deliver = useDeliverOrder();
  const setContext = useSetOrderContext();
  const [approveOpen, setApproveOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);

  useSocketEvent('lab.order.updated', (p) => {
    if (p.order.id === id) {
      void queryClient.invalidateQueries({ queryKey: ['lab', 'order', id] });
    }
  });
  useSocketEvent('invoice.paid', () => {
    void queryClient.invalidateQueries({ queryKey: ['lab', 'order', id] });
  });

  if (orderQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const order = orderQuery.data;
  if (!order) {
    return (
      <EmptyState
        icon={FlaskConical}
        title={t('orderNotFound')}
        action={
          <Button variant="outline" asChild>
            <Link href="/lab">
              <ArrowLeft className="h-4 w-4" />
              {tc('back')}
            </Link>
          </Button>
        }
      />
    );
  }

  const readyToSign = order.items.some((it) => it.complete);
  const signed =
    order.status === LabOrderStatus.APPROVED || order.status === LabOrderStatus.DELIVERED;
  const locked = LOCKED_STATUSES.includes(order.status) || !order.canWork;
  const resultEntryLocked = locked || order.status === LabOrderStatus.ORDERED;
  const signedAt = order.items.find((item) => item.result?.approvedAt)?.result?.approvedAt;
  const canSignResults =
    order.status === LabOrderStatus.RESULTED || order.status === LabOrderStatus.IN_PROGRESS;

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.orderNumber}
        description={order.createdAt ? formatTz(order.createdAt) : undefined}
      >
        <Button variant="ghost" asChild>
          <Link href="/lab">
            <ArrowLeft className="h-4 w-4" />
            {tc('back')}
          </Link>
        </Button>
        {canEnterResults && order.canWork && order.status === LabOrderStatus.ORDERED ? (
          <Button
            variant="outline"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate({ id, status: LabOrderStatus.SPECIMEN_COLLECTED })}
          >
            <Syringe className="h-4 w-4" />
            {t('actionCollect')}
          </Button>
        ) : null}
        {canEnterResults && order.canWork && order.status === LabOrderStatus.SPECIMEN_COLLECTED ? (
          <Button
            variant="outline"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate({ id, status: LabOrderStatus.IN_PROGRESS })}
          >
            <Play className="h-4 w-4" />
            {t('actionStart')}
          </Button>
        ) : null}
        {canApprove && order.canWork && canSignResults && readyToSign ? (
          <Button disabled={approve.isPending} onClick={() => setApproveOpen(true)}>
            <CheckCircle2 className="h-4 w-4" />
            {t('approve')}
          </Button>
        ) : null}
        {canWrite && order.status === LabOrderStatus.APPROVED ? (
          <Button disabled={deliver.isPending} onClick={() => setDeliverOpen(true)}>
            <CheckCheck className="h-4 w-4" />
            {t('deliver')}
          </Button>
        ) : null}
        <Button variant="outline" asChild>
          <Link href={`/lab/${id}/print`}>
            <Printer className="h-4 w-4" />
            {tc('print')}
          </Link>
        </Button>
        {/* Before any result exists the PDF is an empty table with an
            "unapproved" stamp — nothing anyone would hand to a patient. */}
        {(
          [
            LabOrderStatus.RESULTED,
            LabOrderStatus.APPROVED,
            LabOrderStatus.DELIVERED,
          ] as LabOrderStatus[]
        ).includes(order.status) ? (
          <Button
            variant="outline"
            disabled={pdfBusy}
            onClick={async () => {
              setPdfBusy(true);
              try {
                const blob = await api.get<Blob>(`/lab-orders/${id}/pdf`, { locale });
                const url = URL.createObjectURL(blob.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = `natija-${order.orderNumber}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error(t('pdfFailed'));
              } finally {
                setPdfBusy(false);
              }
            }}
          >
            <FileDown className="h-4 w-4" />
            PDF
          </Button>
        ) : null}
      </PageHeader>

      {order.billing && hasUnpaidLabWork(order) ? (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-semibold">{t('paymentWaiting')}</p>
              <p className="text-sm text-muted-foreground">
                {t('paymentRequiredHint', {
                  number: order.billing.number,
                  amount: formatUZS(order.billing.due),
                })}
              </p>
            </div>
            {canReadInvoice ? (
              <Button asChild variant="outline">
                <Link href={`/invoices/${order.billing.invoiceId}`}>{t('openInvoice')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {signed && signedAt ? (
        <p className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
          {t('signedResultHint', { date: formatTz(signedAt) })}
        </p>
      ) : null}
      {!locked && order.status === LabOrderStatus.ORDERED ? (
        <p className="text-sm text-muted-foreground">{t('collectBeforeResults')}</p>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 py-4">
          <div>
            <p className="text-xs text-muted-foreground">{tc('patient')}</p>
            <p className="font-semibold">{order.patient.fullName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('referringDoctor')}</p>
            <p className="text-sm font-medium">
              {order.referringDoctor?.fullName ?? t('directOrder')}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('mrn')}</p>
            <p className="font-mono text-sm">{order.patient.mrn}</p>
          </div>
          {order.patient.dob ? (
            <div>
              <p className="text-xs text-muted-foreground">{t('dob')}</p>
              <p className="text-sm">{formatDate(order.patient.dob)}</p>
            </div>
          ) : null}
          {order.patient.gender ? (
            <div>
              <p className="text-xs text-muted-foreground">{t('gender')}</p>
              <p className="text-sm">{t(`genderLabel.${order.patient.gender}` as never)}</p>
            </div>
          ) : null}
          {order.patient.phone ? (
            <div>
              <p className="text-xs text-muted-foreground">{tc('phone')}</p>
              <p className="text-sm">{formatPhone(order.patient.phone)}</p>
            </div>
          ) : null}
          {order.patient.gender !== Gender.MALE ? (
            <div className="min-w-48">
              <p className="text-xs text-muted-foreground">{t('physiologicalStateLabel')}</p>
              <Select
                value={order.physiologicalState ?? 'NONE'}
                disabled={locked || !canWrite || setContext.isPending}
                onValueChange={(v) =>
                  setContext.mutate({
                    id,
                    state: v === 'NONE' ? null : (v as PhysiologicalState),
                  })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{t('physiologicalState.NONE')}</SelectItem>
                  {Object.values(PhysiologicalState).map((st) => (
                    <SelectItem key={st} value={st}>
                      {t(`physiologicalState.${st}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="ml-auto">
            <StatusBadge status={order.status} label={t(`status.${order.status}` as never)} />
          </div>
        </CardContent>
      </Card>

      <OrderAttachments
        orderId={id}
        attachments={order.attachments ?? []}
        canUpload={canEnterResults && !resultEntryLocked}
      />

      <div className="space-y-4">
        {order.items.map((item) => (
          <OrderItemCard
            key={`${item.id}:${item.result?.updatedAt ?? 'new'}`}
            item={item}
            locked={resultEntryLocked}
            canEnter={canEnterResults}
            attachments={order.attachments ?? []}
          />
        ))}
      </div>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={t('approveConfirmTitle')}
        description={t('approveConfirmDesc')}
        confirmLabel={t('approve')}
        cancelLabel={tc('cancel')}
        onConfirm={() => approve.mutate(id)}
      />
      <ConfirmDialog
        open={deliverOpen}
        onOpenChange={setDeliverOpen}
        title={t('deliverConfirmTitle')}
        description={t('deliverConfirmDesc')}
        confirmLabel={t('deliver')}
        cancelLabel={tc('cancel')}
        onConfirm={() => deliver.mutate(id)}
      />
    </div>
  );
}
