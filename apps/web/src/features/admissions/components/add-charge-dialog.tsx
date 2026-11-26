'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { formatUZS, fromTiyin, toTiyin, type MoneyString } from '@avishifo/shared';
import { todayTashkent } from '@/lib/dates';
import { createId } from '@/lib/id';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ServiceCombobox, serviceName } from '@/features/billing/components/service-combobox';
import { LabServicePicker } from '@/features/billing/components/lab-service-picker';
import { UziServicePicker } from '@/features/billing/components/uzi-service-picker';
import { billingApi, sanitizeMoney, type ServiceOption } from '@/features/billing/api';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import { useApiErrorToast } from '@/features/services/hooks';
import { chargesApi } from '../api';

type ChargeMode =
  | 'procedures'
  | 'lab'
  | 'uzi'
  | 'massage'
  | 'consultation'
  | 'cashier'
  | 'manual';

const CATALOG_MODES: ChargeMode[] = ['procedures', 'lab', 'uzi', 'consultation', 'cashier', 'manual'];
/** Stay charges are settled at discharge, so the ward has no cashier-now mode. */
const STAY_MODES: ChargeMode[] = ['lab', 'uzi', 'massage', 'procedures', 'consultation', 'manual'];

type CatalogLine = {
  key: string;
  service: ServiceOption;
  quantity: number;
  unitPrice: string;
};

function isClinicalMode(mode: ChargeMode): mode is 'uzi' | 'consultation' {
  return mode === 'uzi' || mode === 'consultation';
}

/** Records service/cost lines and sends each invoice to the cashier atomically. */
export function AddChargeDialog({
  open,
  onOpenChange,
  patientId,
  admissionId,
  initialMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  admissionId?: string;
  /** Prefill mode (e.g. doctor opens Lab/UZI from Bemorlarim). */
  initialMode?: ChargeMode;
}) {
  const t = useTranslations('charges');
  const tc = useTranslations('common');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorToast = useApiErrorToast();
  const titleId = useId();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const role = useAuthStore((s) => s.user?.role);
  const wardDoctor = role === 'DOCTOR' && Boolean(admissionId);
  const modes = admissionId ? STAY_MODES : CATALOG_MODES;
  const [mode, setMode] = useState<ChargeMode>(initialMode ?? (wardDoctor ? 'lab' : 'procedures'));
  const [date, setDate] = useState(todayTashkent());
  const [lines, setLines] = useState<CatalogLine[]>([]);
  const [doctorUserId, setDoctorUserId] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [manualPrice, setManualPrice] = useState('');
  const lineKeys = useRef<Map<string, string>>(new Map());
  const manualKey = useRef<string | null>(null);
  const clinicalKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode ?? (wardDoctor ? 'lab' : 'procedures'));
    setDate(todayTashkent());
    setLines([]);
    setDoctorUserId('');
    setManualTitle('');
    setManualQty(1);
    setManualPrice('');
    lineKeys.current = new Map();
    manualKey.current = null;
    clinicalKey.current = null;
  }, [open, patientId, admissionId, initialMode, wardDoctor]);

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
    enabled: open && isClinicalMode(mode) && Boolean(branchId),
  });
  const doctorOptions = (doctors.data ?? []).filter((doctor) =>
    mode === 'uzi' ? isUziSpecialty(doctor.specialty) : true,
  );
  const selectedDoctor =
    doctorOptions.find((doctor) => doctor.id === doctorUserId) ?? null;

  /** Same quick chips as ambulatory: EKG, Holter, SMAD, ozone, hydrocolon… */
  const diagnosticsQuick = useQuery({
    queryKey: ['services', 'billing-search', 'DIAGNOSTICS', ''],
    queryFn: async () => (await billingApi.searchServices('', 'DIAGNOSTICS')).data,
    enabled: open && mode === 'procedures',
    staleTime: 60_000,
  });

  const pushCatalogLine = (service: ServiceOption) => {
    setLines((prev) => {
      const existing = prev.find((line) => line.service.id === service.id);
      if (existing)
        return prev.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: Math.min(999, line.quantity + 1) }
            : line,
        );
      return [
        ...prev,
        {
          key: createId(),
          service,
          quantity: 1,
          unitPrice: service.currentPrice ?? '0',
        },
      ];
    });
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['charges', patientId] });
    void qc.invalidateQueries({ queryKey: ['admission'] });
    void qc.invalidateQueries({ queryKey: ['patients'] });
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['admission-discharge-check'] });
    void qc.invalidateQueries({ queryKey: ['clinical-orders'] });
  };

  const add = useMutation({
    mutationFn: async () => {
      if (isClinicalMode(mode)) {
        if (!branchId) throw new Error('branch');
        if (!doctorUserId) throw new Error('doctor');
        if (!clinicalKey.current) clinicalKey.current = createId();
        const body = {
          patientId,
          branchId,
          doctorUserId,
          kind: (mode === 'uzi' ? 'ULTRASOUND' : 'CONSULTATION') as 'ULTRASOUND' | 'CONSULTATION',
          serviceIds: lines.map((line) => line.service.id),
          idempotencyKey: clinicalKey.current,
        };
        // Stay orders go on the stay account (held until discharge), whoever enters them.
        if (admissionId) {
          await clinicalOrdersApi.createInpatient(body);
        } else {
          await clinicalOrdersApi.create(body);
        }
        return lines.length;
      }
      const cashierOnly = mode === 'cashier' ? true : undefined;
      if (mode === 'manual') {
        if (!manualKey.current) manualKey.current = createId();
        const unitPrice = fromTiyin(toTiyin(sanitizeMoney(manualPrice) || '0'));
        await chargesApi.add({
          patientId,
          admissionId,
          date,
          quantity: manualQty,
          title: manualTitle.trim(),
          unitPrice,
          idempotencyKey: manualKey.current,
        });
        return 1;
      }
      for (const line of lines) {
        let key = lineKeys.current.get(line.key);
        if (!key) {
          key = createId();
          lineKeys.current.set(line.key, key);
        }
        const unitPrice = fromTiyin(
          toTiyin(sanitizeMoney(line.unitPrice) || line.service.currentPrice || '0'),
        );
        await chargesApi.add({
          patientId,
          admissionId,
          date,
          quantity: line.quantity,
          serviceId: line.service.id,
          unitPrice,
          idempotencyKey: key,
          ...(cashierOnly ? { cashierOnly: true } : {}),
        });
      }
      return lines.length;
    },
    onSuccess: (count) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['admission-reports'] });
      toast.success(
        wardDoctor
          ? count > 1
            ? t('add.doctorSavedMany', { count })
            : t('add.doctorSaved')
          : count > 1
            ? t('add.savedMany', { count })
            : t('add.saved'),
      );
      lineKeys.current = new Map();
      manualKey.current = null;
      clinicalKey.current = null;
      onOpenChange(false);
    },
    onError: errorToast,
  });

  const switchMode = (value: ChargeMode) => {
    setMode(value);
    setLines([]);
    setDoctorUserId('');
    setManualTitle('');
    setManualQty(1);
    setManualPrice('');
    lineKeys.current = new Map();
    manualKey.current = null;
    clinicalKey.current = null;
  };

  const isCatalog = mode !== 'manual';
  const clinical = isClinicalMode(mode);
  const canSubmit = isCatalog
    ? lines.length > 0 &&
      lines.every((line) => line.quantity >= 1) &&
      (!clinical || Boolean(doctorUserId))
    : Boolean(manualTitle.trim() && manualQty >= 1 && sanitizeMoney(manualPrice));

  const totalLabel = (() => {
    try {
      if (!isCatalog) {
        return formatUZS(
          fromTiyin(toTiyin(sanitizeMoney(manualPrice) || '0') * BigInt(Math.max(0, manualQty))),
        );
      }
      const tiyin = lines.reduce((sum, line) => {
        const price = sanitizeMoney(line.unitPrice) || line.service.currentPrice || '0';
        return sum + toTiyin(price as MoneyString) * BigInt(Math.max(0, line.quantity));
      }, 0n);
      return formatUZS(fromTiyin(tiyin));
    } catch {
      return formatUZS('0');
    }
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!add.isPending) onOpenChange(value);
      }}
    >
      <DialogContent
        className={
          mode === 'uzi'
            ? 'max-h-[90vh] overflow-y-auto sm:max-w-3xl'
            : 'sm:max-w-xl'
        }
      >
        <DialogHeader>
          <DialogTitle>
            {wardDoctor
              ? t('add.doctorTitle')
              : mode === 'cashier'
                ? t('add.cashierTitle')
                : t('add.title')}
          </DialogTitle>
          <DialogDescription>
            {wardDoctor
              ? t('add.doctorHint')
              : mode === 'cashier'
                ? t('add.cashierHint')
                : t('add.hint')}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={add.isPending} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {modes.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={mode === value ? 'default' : 'outline'}
                onClick={() => switchMode(value)}
              >
                {t(`add.modes.${value}`)}
              </Button>
            ))}
          </div>
          {wardDoctor && (mode === 'lab' || mode === 'uzi') ? (
            <p className="text-xs text-muted-foreground">{t('add.doctorPriceHint')}</p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="charge-date">{t('add.date')}</Label>
            <Input
              id="charge-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {clinical ? (
            <div className="space-y-2">
              <Label>{t('add.doctor')}</Label>
              <Select
                value={doctorUserId}
                disabled={doctors.isLoading || doctors.isError || !doctorOptions.length}
                onValueChange={(id) => {
                  setDoctorUserId(id);
                  // Switching UZI doctor must drop the previous doctor's catalogue rows.
                  if (mode === 'uzi') setLines([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={doctors.isLoading ? tc('loading') : t('add.doctorPlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {doctorOptions.map((doctor) => (
                    <SelectItem key={doctor.id} value={doctor.id}>
                      {doctor.fullName}
                      {doctor.specialty ? ` · ${doctor.specialty}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {doctors.isError ? (
                <p className="text-xs text-destructive">{t('add.doctorLoadError')}</p>
              ) : null}
              {doctors.isSuccess && !doctorOptions.length ? (
                <p className="text-xs text-destructive">{t('add.doctorEmpty')}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {mode === 'uzi' ? t('add.doctorUziHint') : t('add.doctorConsultHint')}
              </p>
            </div>
          ) : null}

          {isCatalog ? (
            <div className="space-y-3">
              {mode === 'uzi' || mode === 'lab' ? (
                <div className="space-y-2">
                  <Label>{t('add.service')}</Label>
                  {mode === 'uzi' ? (
                    <UziServicePicker
                      selected={lines.map((line) => line.service)}
                      doctor={selectedDoctor}
                      disabled={add.isPending || !doctorUserId}
                      onChange={(next) => {
                        setLines((prev) => {
                          const prevById = new Map(prev.map((line) => [line.service.id, line]));
                          return next.map((service) => {
                            const existing = prevById.get(service.id);
                            if (existing) return existing;
                            return {
                              key: createId(),
                              service,
                              quantity: 1,
                              unitPrice: service.currentPrice ?? '0',
                            };
                          });
                        });
                      }}
                    />
                  ) : (
                    <LabServicePicker
                      selected={lines.map((line) => line.service)}
                      disabled={add.isPending}
                      onChange={(next) => {
                        setLines((prev) => {
                          const prevById = new Map(prev.map((line) => [line.service.id, line]));
                          return next.map((service) => {
                            const existing = prevById.get(service.id);
                            if (existing) return existing;
                            return {
                              key: createId(),
                              service,
                              quantity: 1,
                              unitPrice: service.currentPrice ?? '0',
                            };
                          });
                        });
                      }}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(`add.modeHints.${mode}`)}
                  </p>
                </div>
              ) : (
                <>
                  {mode === 'procedures' && diagnosticsQuick.data?.length ? (
                    <div className="space-y-1.5">
                      <Label>{t('add.quickAdd')}</Label>
                      <div className="flex flex-wrap gap-2">
                        {diagnosticsQuick.data.map((service) => (
                          <Button
                            key={service.id}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={add.isPending}
                            onClick={() => pushCatalogLine(service)}
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
                  <div className="space-y-2">
                    <Label>{t('add.service')}</Label>
                    <ServiceCombobox
                      key={`${mode}:${doctorUserId}`}
                      excludeSurgery
                      disabled={add.isPending || (clinical && !doctorUserId)}
                      proceduresOnly={mode === 'procedures'}
                      massageOnly={mode === 'massage'}
                      kind={mode === 'consultation' ? 'CONSULTATION' : undefined}
                      doctor={null}
                      excludeIds={lines.map((line) => line.service.id)}
                      value={null}
                      onChange={pushCatalogLine}
                    />
                    <p className="text-xs text-muted-foreground">{t(`add.modeHints.${mode}`)}</p>
                    <p className="text-xs text-muted-foreground">{t('add.multiHint')}</p>
                  </div>

                  <ul className="divide-y rounded-lg border">
                    {lines.map((line) => (
                      <li
                        key={line.key}
                        className={
                          clinical
                            ? 'grid gap-2 p-3 sm:grid-cols-[1fr_120px_36px]'
                            : 'grid gap-2 p-3 sm:grid-cols-[1fr_72px_120px_36px]'
                        }
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {serviceName(line.service, locale)}
                          </p>
                          <p className="text-xs text-muted-foreground">{line.service.code}</p>
                        </div>
                        {!clinical ? (
                          <div className="space-y-1">
                            <span className="text-xs text-muted-foreground">{t('add.quantity')}</span>
                            <Input
                              type="number"
                              min={1}
                              max={999}
                              value={line.quantity}
                              onChange={(e) => {
                                const quantity = Math.max(
                                  1,
                                  Math.min(999, Number(e.target.value) || 1),
                                );
                                setLines((prev) =>
                                  prev.map((item) =>
                                    item.key === line.key ? { ...item, quantity } : item,
                                  ),
                                );
                              }}
                            />
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">{t('add.price')}</span>
                          {clinical ? (
                            <p className="flex h-9 items-center text-sm tabular-nums">
                              {formatUZS(line.unitPrice as MoneyString)}
                            </p>
                          ) : (
                            <Input
                              inputMode="decimal"
                              value={line.unitPrice}
                              onChange={(e) => {
                                const unitPrice = e.target.value;
                                setLines((prev) =>
                                  prev.map((item) =>
                                    item.key === line.key ? { ...item, unitPrice } : item,
                                  ),
                                );
                              }}
                            />
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="self-end text-destructive"
                          aria-label={tc('delete')}
                          onClick={() => {
                            lineKeys.current.delete(line.key);
                            setLines((prev) => prev.filter((item) => item.key !== line.key));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                    {!lines.length ? (
                      <li className="p-4 text-sm text-muted-foreground">{t('add.pickServices')}</li>
                    ) : null}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={titleId}>{t('add.name')}</Label>
                <Input
                  id={titleId}
                  maxLength={200}
                  required
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="charge-qty">{t('add.quantity')}</Label>
                  <Input
                    id="charge-qty"
                    type="number"
                    min={1}
                    max={999}
                    value={manualQty}
                    onChange={(e) => setManualQty(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="charge-price">{t('add.price')}</Label>
                  <Input
                    id="charge-price"
                    inputMode="decimal"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <span>{t('add.total')}</span>
            <strong className="tabular-nums">{totalLabel}</strong>
          </div>
        </fieldset>

        <DialogFooter>
          <Button
            disabled={add.isPending}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={add.isPending || !canSubmit}
            onClick={() => add.mutate()}
          >
            {wardDoctor ? t('add.doctorSubmit') : t('add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
