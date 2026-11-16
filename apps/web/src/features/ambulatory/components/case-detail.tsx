'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  FlaskConical,
  ClipboardPlus,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { formatPhone, formatUZS, fromTiyin, toTiyin, type MoneyString } from '@avishifo/shared';
import { createId } from '@/lib/id';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { Link, useRouter } from '@/i18n/routing';
import { usePermissions } from '@/hooks/use-permissions';
import { useAuthStore } from '@/stores/auth-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useApiErrorToast } from '@/features/services/hooks';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import { LabServicePicker } from '@/features/billing/components/lab-service-picker';
import { UziServicePicker } from '@/features/billing/components/uzi-service-picker';
import { ServiceCombobox, serviceName } from '@/features/billing/components/service-combobox';
import { billingApi, sanitizeMoney, type ServiceOption } from '@/features/billing/api';
import { ambulatoryApi, type AmbulatoryCaseDetail } from '../api';
import { paymentBadge } from './commissions-tab';

const LAB_READY = new Set(['APPROVED', 'DELIVERED']);

function EditCaseDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: AmbulatoryCaseDetail;
}) {
  const t = useTranslations('ambulatory');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const isDoctor = useAuthStore((s) => s.user?.role === 'DOCTOR');
  const [doctorId, setDoctorId] = useState(data.doctorUserId);
  const [complaint, setComplaint] = useState(data.complaint ?? '');
  const [diagnosis, setDiagnosis] = useState(data.diagnosis ?? '');
  const [note, setNote] = useState(data.note ?? '');
  const canChangeDoctor =
    !isDoctor && data.labOrders.length === 0 && data.consultations.length === 0;

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: open && canChangeDoctor && Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });

  const save = useMutation({
    mutationFn: () =>
      ambulatoryApi.update(data.id, {
        doctorUserId: canChangeDoctor && doctorId !== data.doctorUserId ? doctorId : undefined,
        complaint: complaint.trim() || null,
        diagnosis: diagnosis.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      toast.success(t('detail.saved'));
      onOpenChange(false);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('detail.editTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {canChangeDoctor ? (
            <div className="space-y-1.5">
              <Label>{t('fields.doctor')}</Label>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(doctors.data ?? [])
                    .filter((doctor) => !isUziSpecialty(doctor.specialty))
                    .map((doctor) => (
                      <SelectItem key={doctor.id} value={doctor.id}>
                        {doctor.fullName}
                        {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                      </SelectItem>
                    ))}
                  {!(doctors.data ?? []).some((doctor) => doctor.id === data.doctorUserId) ? (
                    <SelectItem value={data.doctorUserId}>{data.doctorName}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : !isDoctor ? (
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {t('detail.doctorLocked')}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="amb-edit-complaint">{t('fields.complaint')}</Label>
            <Input
              id="amb-edit-complaint"
              value={complaint}
              maxLength={500}
              onChange={(event) => setComplaint(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amb-edit-diagnosis">{t('fields.diagnosis')}</Label>
            <Input
              id="amb-edit-diagnosis"
              value={diagnosis}
              maxLength={500}
              onChange={(event) => setDiagnosis(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amb-edit-note">{t('fields.note')}</Label>
            <Textarea
              id="amb-edit-note"
              rows={2}
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('detail.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendLabCard({ data }: { data: AmbulatoryCaseDetail }) {
  const t = useTranslations('ambulatory');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const total = services.reduce((sum, service) => sum + Number(service.currentPrice ?? 0), 0);
  const share = Math.round(total * data.currentPercents.LAB) / 100;

  const send = useMutation({
    mutationFn: () => ambulatoryApi.sendLab(data.id, { serviceIds: services.map((s) => s.id) }),
    onSuccess: (res) => {
      queryClient.setQueryData(['ambulatory', 'case', data.id], res.data);
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
      setServices([]);
      toast.success(t('detail.labSent'));
    },
    onError: errorToast,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-primary" />
          {t('detail.sendLab')}
        </CardTitle>
        <Badge variant="secondary">{t('detail.shareBadge', { percent: data.currentPercents.LAB })}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <LabServicePicker selected={services} onChange={setServices} disabled={send.isPending} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('detail.labPreview', {
              count: services.length,
              total: formatUZS(total.toFixed(2)),
              share: formatUZS(share.toFixed(2)),
            })}
          </span>
          <Button
            disabled={services.length === 0 || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('detail.sendToCashier')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SendUziCard({ data }: { data: AmbulatoryCaseDetail }) {
  const t = useTranslations('ambulatory');
  const tCommon = useTranslations('common');
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [doctorId, setDoctorId] = useState('');
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [note, setNote] = useState('');

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    enabled: Boolean(branchId),
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
  });
  const uziDoctors = useMemo(
    () => (doctors.data ?? []).filter((doctor) => isUziSpecialty(doctor.specialty)),
    [doctors.data],
  );

  const send = useMutation({
    mutationFn: () =>
      ambulatoryApi.sendUzi(data.id, {
        doctorUserId: doctorId,
        serviceIds: services.map((s) => s.id),
        note: note.trim() || undefined,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(['ambulatory', 'case', data.id], res.data);
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
      setServices([]);
      setNote('');
      toast.success(t('detail.uziSent'));
    },
    onError: errorToast,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          {t('detail.sendUzi')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>{t('detail.uziDoctor')}</Label>
            <Select
              value={doctorId || undefined}
              onValueChange={(value) => {
                setDoctorId(value);
                setServices([]);
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={tCommon('select')} />
              </SelectTrigger>
              <SelectContent>
                {uziDoctors.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.fullName}
                    {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44 flex-1 space-y-1.5">
            <Label htmlFor="amb-uzi-note">{t('fields.note')}</Label>
            <Input
              id="amb-uzi-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        {!uziDoctors.length && doctors.isFetched ? (
          <p className="text-xs text-muted-foreground">{t('detail.noUziDoctors')}</p>
        ) : null}
        <UziServicePicker
          selected={services}
          onChange={setServices}
          doctor={uziDoctors.find((doctor) => doctor.id === doctorId) ?? null}
          disabled={!doctorId || send.isPending}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {data.currentPercents.UZI > 0 || data.currentPercents.EXO > 0
              ? t('detail.uziShare', { uzi: data.currentPercents.UZI, exo: data.currentPercents.EXO })
              : t('detail.uziNoShare')}
          </span>
          <Button
            disabled={!doctorId || services.length === 0 || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('detail.sendToCashier')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type ServiceLine = {
  key: string;
  serviceId?: string;
  title: string;
  unitPrice: string;
  quantity: number;
};

function lineTiyin(line: ServiceLine): bigint {
  try {
    return toTiyin((sanitizeMoney(line.unitPrice) || '0') as MoneyString) * BigInt(line.quantity);
  } catch {
    return 0n;
  }
}

/** Procedures, diagnostics (EKG…) or free-text lines; the bill goes to the cashier at once. */
function AddServicesCard({ data }: { data: AmbulatoryCaseDetail }) {
  const t = useTranslations('ambulatory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [manualTitle, setManualTitle] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const requestKey = useRef<string | null>(null);

  const quick = useQuery({
    queryKey: ['services', 'billing-search', 'DIAGNOSTICS', ''],
    queryFn: async () => (await billingApi.searchServices('', 'DIAGNOSTICS')).data,
    staleTime: 60_000,
  });

  const addService = (service: ServiceOption) => {
    requestKey.current = null;
    setLines((prev) => {
      const existing = prev.find((line) => line.serviceId === service.id);
      if (existing)
        return prev.map((line) =>
          line.key === existing.key ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line,
        );
      return [
        ...prev,
        {
          key: createId(),
          serviceId: service.id,
          title: serviceName(service, locale),
          unitPrice: service.currentPrice ?? '0',
          quantity: 1,
        },
      ];
    });
  };

  const manualPriceValue = sanitizeMoney(manualPrice);
  const manualValid =
    Boolean(manualTitle.trim()) && /^\d{1,12}(\.\d{1,2})?$/.test(manualPriceValue) && Number(manualPriceValue) > 0;

  const addManual = () => {
    if (!manualValid) return;
    requestKey.current = null;
    setLines((prev) => [
      ...prev,
      { key: createId(), title: manualTitle.trim(), unitPrice: manualPriceValue, quantity: manualQty },
    ]);
    setManualTitle('');
    setManualPrice('');
    setManualQty(1);
  };

  const total = fromTiyin(lines.reduce((sum, line) => sum + lineTiyin(line), 0n));

  const send = useMutation({
    mutationFn: () => {
      if (!requestKey.current) requestKey.current = createId();
      return ambulatoryApi.addServices(data.id, {
        idempotencyKey: requestKey.current,
        items: lines.map((line) =>
          line.serviceId
            ? { serviceId: line.serviceId, quantity: line.quantity }
            : { title: line.title, unitPrice: sanitizeMoney(line.unitPrice), quantity: line.quantity },
        ),
      });
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['ambulatory', 'case', data.id], res.data);
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setLines([]);
      requestKey.current = null;
      toast.success(t('detail.servicesSent'));
    },
    onError: errorToast,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardPlus className="h-4 w-4 text-primary" />
          {t('detail.addServices')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('detail.servicesHint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={send.isPending} className="space-y-4">
          {quick.data?.length ? (
            <div className="space-y-1.5">
              <Label>{t('detail.quickAdd')}</Label>
              <div className="flex flex-wrap gap-2">
                {quick.data.slice(0, 8).map((service) => (
                  <Button
                    key={service.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addService(service)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {serviceName(service, locale)}
                    {service.currentPrice ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatUZS(service.currentPrice)}
                      </span>
                    ) : null}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('detail.fromCatalog')}</Label>
              <ServiceCombobox
                value={null}
                proceduresOnly
                excludeSurgery
                onChange={addService}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amb-manual-title">{t('detail.manualEntry')}</Label>
              <div className="grid grid-cols-[1fr_110px_64px_auto] gap-2">
                <Input
                  id="amb-manual-title"
                  placeholder={t('detail.manualName')}
                  maxLength={200}
                  value={manualTitle}
                  onChange={(event) => setManualTitle(event.target.value)}
                />
                <Input
                  inputMode="decimal"
                  placeholder={t('detail.manualPrice')}
                  aria-label={t('detail.manualPrice')}
                  value={manualPrice}
                  onChange={(event) => setManualPrice(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addManual();
                  }}
                />
                <Input
                  type="number"
                  min={1}
                  max={99}
                  aria-label={t('detail.quantity')}
                  value={manualQty}
                  onChange={(event) =>
                    setManualQty(Math.max(1, Math.min(99, Number(event.target.value) || 1)))
                  }
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  disabled={!manualValid}
                  aria-label={t('detail.addLine')}
                  onClick={addManual}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <ul className="divide-y rounded-lg border">
            {lines.map((line) => (
              <li key={line.key} className="grid items-center gap-2 p-3 sm:grid-cols-[1fr_72px_120px_36px]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.serviceId ? formatUZS(line.unitPrice as MoneyString) : t('detail.manualBadge')}
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  aria-label={t('detail.quantity')}
                  value={line.quantity}
                  onChange={(event) => {
                    requestKey.current = null;
                    const quantity = Math.max(1, Math.min(99, Number(event.target.value) || 1));
                    setLines((prev) =>
                      prev.map((item) => (item.key === line.key ? { ...item, quantity } : item)),
                    );
                  }}
                />
                <p className="text-right text-sm tabular-nums">{formatUZS(fromTiyin(lineTiyin(line)))}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  aria-label={tc('delete')}
                  onClick={() => {
                    requestKey.current = null;
                    setLines((prev) => prev.filter((item) => item.key !== line.key));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
            {!lines.length ? (
              <li className="p-4 text-sm text-muted-foreground">{t('detail.pickServices')}</li>
            ) : null}
          </ul>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t('detail.servicesPreview', { count: lines.length, total: formatUZS(total) })}
          </span>
          <Button disabled={lines.length === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {t('detail.sendToCashier')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CaseDetail({ caseId }: { caseId: string }) {
  const t = useTranslations('ambulatory');
  const tc = useTranslations('common');
  const locale = useLocale();
  const can = usePermissions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorToast = useApiErrorToast();
  const isDoctor = useAuthStore((s) => s.user?.role === 'DOCTOR');
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const query = useQuery({
    queryKey: ['ambulatory', 'case', caseId],
    queryFn: async () => (await ambulatoryApi.get(caseId)).data,
    refetchInterval: (current) => (current.state.data?.status === 'OPEN' ? 10_000 : false),
  });

  const toggle = useMutation({
    mutationFn: (close: boolean) =>
      close ? ambulatoryApi.close(caseId) : ambulatoryApi.reopen(caseId),
    onSuccess: (res, close) => {
      queryClient.setQueryData(['ambulatory', 'case', caseId], res.data);
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      toast.success(close ? t('detail.closed') : t('detail.reopened'));
    },
    onError: errorToast,
  });

  const remove = useMutation({
    mutationFn: () => ambulatoryApi.remove(caseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ambulatory'] });
      toast.success(t('detail.removed'));
      router.push('/ambulatory');
    },
    onError: errorToast,
  });

  if (query.isLoading) return <Skeleton className="h-96 w-full" />;
  const data = query.data;
  if (!data) return null;

  const isOpen = data.status === 'OPEN';
  const canWrite = can('ambulatory.write');
  const canSend = canWrite && isOpen && !data.activeStay;
  const empty =
    data.labOrders.length === 0 &&
    data.uziOrders.length === 0 &&
    data.consultations.length === 0 &&
    data.services.length === 0;
  const stats = [
    { key: 'commission', value: formatUZS(data.totals.commission), accent: true },
    { key: 'pendingCommission', value: formatUZS(data.totals.pendingCommission) },
    { key: 'paidAmount', value: formatUZS(data.totals.paidAmount) },
    { key: 'amount', value: formatUZS(data.totals.amount) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
            <Link href="/ambulatory">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('detail.back')}
            </Link>
          </Button>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight">
            {data.patient.fullName}
            <Badge variant={isOpen ? 'default' : 'outline'}>{t(`status.${data.status}`)}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{data.number}</span>
            {' · '}
            {[
              `${t('fields.doctor')}: ${data.doctorName}`,
              data.patient.mrn,
              data.patient.phone ? formatPhone(data.patient.phone) : null,
              formatTz(data.openedAt),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              {t('detail.edit')}
            </Button>
            {isOpen ? (
              <Button
                variant="secondary"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(true)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {t('detail.close')}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(false)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {t('detail.reopen')}
              </Button>
            )}
            {empty ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRemoveOpen(true)}
                aria-label={t('detail.remove')}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.key}
            className={
              stat.accent ? 'border-primary/40 bg-gradient-to-br from-primary/10 to-transparent' : undefined
            }
          >
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{t(`commissions.${stat.key}`)}</p>
              <p
                className={`mt-2 text-xl font-semibold tabular-nums ${stat.accent ? 'text-primary' : ''}`}
              >
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.complaint || data.diagnosis || data.note ? (
        <Card>
          <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-3">
            {(['complaint', 'diagnosis', 'note'] as const).map((key) =>
              data[key] ? (
                <div key={key}>
                  <p className="text-xs text-muted-foreground">{t(`fields.${key}`)}</p>
                  <p className="whitespace-pre-wrap">{data[key]}</p>
                </div>
              ) : null,
            )}
          </CardContent>
        </Card>
      ) : null}

      {data.activeStay && isOpen ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('detail.inpatientWarning', { number: data.activeStay.historyNumber })}{' '}
            {!isDoctor ? (
              <Link href={`/admissions/${data.activeStay.id}`} className="font-medium underline">
                {t('detail.openStay')}
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}

      {data.consultations.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="h-4 w-4 text-primary" />
              {t('detail.consultations')}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('commissions.date')}</TableHead>
                  <TableHead>{t('detail.consultationService')}</TableHead>
                  <TableHead className="text-right">{t('detail.uziTotal')}</TableHead>
                  <TableHead>{t('detail.labStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.consultations.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTz(order.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-80">
                      <p className="line-clamp-2">
                        {order.services
                          .map((service) => localizedText(service.title, locale))
                          .join(', ')}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {order.invoice.number}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUZS(order.invoice.total)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.status === 'WAITING_PAYMENT' ? 'outline' : 'default'}>
                        {order.status === 'WAITING_PAYMENT'
                          ? t('payment.UNPAID')
                          : order.status === 'CANCELLED'
                            ? t('uziStatus.CANCELLED')
                            : t('payment.PAID')}
                      </Badge>
                      {order.visitId && can('visits.read') ? (
                        <Link
                          href={`/doctor/visits/${order.visitId}`}
                          className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          {order.status === 'COMPLETED' ? t('detail.openResult') : t('detail.openVisit')}
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {canSend ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <SendLabCard data={data} />
            <SendUziCard data={data} />
          </div>
          <AddServicesCard data={data} />
        </>
      ) : !isOpen && canWrite ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t('detail.closedHint')}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('detail.labOrders')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {data.labOrders.length === 0 ? (
            <EmptyState icon={FlaskConical} title={t('detail.noLab')} className="py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('commissions.date')}</TableHead>
                  <TableHead>{t('commissions.tests')}</TableHead>
                  <TableHead>{t('detail.labStatus')}</TableHead>
                  <TableHead className="text-right">{t('commissions.labAmount')}</TableHead>
                  <TableHead className="text-right">{t('commissions.paidAmount')}</TableHead>
                  <TableHead className="text-right">{t('commissions.commission')}</TableHead>
                  <TableHead>{t('commissions.payment')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.labOrders.map((order) => (
                  <TableRow key={order.orderId} className={order.cancelled ? 'opacity-60' : undefined}>
                    <TableCell className="whitespace-nowrap">
                      <p className="text-muted-foreground">{formatTz(order.createdAt)}</p>
                      <Link
                        href={`/lab/${order.orderId}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-80">
                      <p className="line-clamp-2">
                        {order.tests.map((name) => localizedText(name, locale)).join(', ')}
                      </p>
                      {order.invoiceNumber ? (
                        <p className="font-mono text-xs text-muted-foreground">
                          {order.invoiceNumber}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={LAB_READY.has(order.status) ? 'default' : 'outline'}>
                        {order.cancelled
                          ? t('detail.cancelled')
                          : LAB_READY.has(order.status)
                            ? t('detail.labReady')
                            : t('detail.labInWork')}
                      </Badge>
                      {!order.cancelled && LAB_READY.has(order.status) ? (
                        <Link
                          href={`/lab/${order.orderId}/print`}
                          className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          {t('detail.openResult')}
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUZS(order.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUZS(order.paidAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="font-semibold text-primary">
                        {formatUZS(order.commission)}
                      </span>
                      <p className="text-xs text-muted-foreground">{order.percent}%</p>
                    </TableCell>
                    <TableCell>
                      {order.cancelled ? null : (
                        <Badge variant={paymentBadge[order.paymentState]}>
                          {t(`payment.${order.paymentState}`)}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('detail.uziOrders')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {data.uziOrders.length === 0 ? (
            <EmptyState icon={Activity} title={t('detail.noUzi')} className="py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('commissions.date')}</TableHead>
                  <TableHead>{t('detail.uziServices')}</TableHead>
                  <TableHead>{t('detail.uziDoctor')}</TableHead>
                  <TableHead className="text-right">{t('detail.uziTotal')}</TableHead>
                  <TableHead className="text-right">{t('commissions.commission')}</TableHead>
                  <TableHead>{t('detail.labStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.uziOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTz(order.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-80">
                      <p className="line-clamp-2">
                        {order.services
                          .map((service) => localizedText(service.title, locale))
                          .join(', ')}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {order.invoice.number}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{order.doctor.fullName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUZS(order.invoice.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(order.shares ?? []).filter((part) => part.percent > 0).length ? (
                        (order.shares ?? [])
                          .filter((part) => part.percent > 0)
                          .map((part) => (
                            <div key={part.group}>
                              <span className="font-semibold text-primary">
                                {formatUZS(part.commission)}
                              </span>
                              <p className="text-xs text-muted-foreground">
                                {t(`groups.${part.group}`)} · {part.percent}%
                              </p>
                            </div>
                          ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.status === 'COMPLETED' ? 'default' : 'outline'}>
                        {t(`uziStatus.${order.status}`)}
                      </Badge>
                      {order.status === 'COMPLETED' && order.visitId && can('visits.read') ? (
                        <Link
                          href={`/doctor/visits/${order.visitId}/print`}
                          className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          {t('detail.openResult')}
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.services.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('detail.services')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('commissions.date')}</TableHead>
                  <TableHead>{t('detail.consultationService')}</TableHead>
                  <TableHead className="text-right">{t('detail.quantity')}</TableHead>
                  <TableHead className="text-right">{t('detail.uziTotal')}</TableHead>
                  <TableHead>{t('commissions.payment')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.services.map((service) => (
                  <TableRow key={service.id} className={service.cancelled ? 'opacity-60' : undefined}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTz(service.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-80">
                      <p className="line-clamp-2">{localizedText(service.title, locale)}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {service.invoiceNumber ?? ''}
                        {service.serviceId ? '' : ` · ${t('detail.manualBadge')}`}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{service.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUZS(service.lineTotal)}
                    </TableCell>
                    <TableCell>
                      {service.cancelled || !service.paymentState ? (
                        <Badge variant="outline">{t('detail.cancelled')}</Badge>
                      ) : (
                        <Badge variant={paymentBadge[service.paymentState]}>
                          {t(`payment.${service.paymentState}`)}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {canWrite ? <EditCaseDialog key={String(editOpen)} open={editOpen} onOpenChange={setEditOpen} data={data} /> : null}

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.removeHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('detail.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
