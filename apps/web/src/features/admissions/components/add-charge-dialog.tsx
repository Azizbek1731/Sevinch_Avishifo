'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
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
import { sanitizeMoney, type ServiceOption } from '@/features/billing/api';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { isUziSpecialty } from '@/features/clinical-orders/doctor-matching';
import { useApiErrorToast } from '@/features/services/hooks';
import { chargesApi } from '../api';

type ChargeMode = 'procedures' | 'lab' | 'uzi' | 'consultation' | 'cashier' | 'manual';

const CATALOG_MODES: ChargeMode[] = ['procedures', 'lab', 'uzi', 'consultation', 'cashier'];

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  admissionId?: string;
}) {
  const t = useTranslations('charges');
  const tc = useTranslations('common');
  const locale = useLocale();
  const qc = useQueryClient();
  const errorToast = useApiErrorToast();
  const titleId = useId();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const [mode, setMode] = useState<ChargeMode>('procedures');
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
    setMode('procedures');
    setDate(todayTashkent());
    setLines([]);
    setDoctorUserId('');
    setManualTitle('');
    setManualQty(1);
    setManualPrice('');
    lineKeys.current = new Map();
    manualKey.current = null;
    clinicalKey.current = null;
  }, [open, patientId, admissionId]);

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
    enabled: open && isClinicalMode(mode) && Boolean(branchId),
  });
  const doctorOptions = (doctors.data ?? []).filter((doctor) =>
    mode === 'uzi' ? isUziSpecialty(doctor.specialty) : true,
  );

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
        await clinicalOrdersApi.create({
          patientId,
          branchId,
          doctorUserId,
          kind: mode === 'uzi' ? 'ULTRASOUND' : 'CONSULTATION',
          serviceIds: lines.map((line) => line.service.id),
          idempotencyKey: clinicalKey.current,
        });
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
      toast.success(count > 1 ? t('add.savedMany', { count }) : t('add.saved'));
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'cashier' ? t('add.cashierTitle') : t('add.title')}</DialogTitle>
          <DialogDescription>
            {mode === 'cashier' ? t('add.cashierHint') : t('add.hint')}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={add.isPending} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {([...CATALOG_MODES, 'manual'] as ChargeMode[]).map((value) => (
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
                onValueChange={setDoctorUserId}
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
              <div className="space-y-2">
                <Label>{t('add.service')}</Label>
                <ServiceCombobox
                  key={mode}
                  excludeSurgery
                  disabled={add.isPending || (clinical && !doctorUserId)}
                  proceduresOnly={mode === 'procedures'}
                  kind={
                    mode === 'lab'
                      ? 'LAB'
                      : mode === 'uzi'
                        ? 'ULTRASOUND'
                        : mode === 'consultation'
                          ? 'CONSULTATION'
                          : undefined
                  }
                  excludeIds={lines.map((line) => line.service.id)}
                  value={null}
                  onChange={(service) => {
                    setLines((prev) => [
                      ...prev,
                      {
                        key: createId(),
                        service,
                        quantity: 1,
                        unitPrice: service.currentPrice ?? '0',
                      },
                    ]);
                  }}
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
                            const quantity = Math.max(1, Math.min(999, Number(e.target.value) || 1));
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
            {t('add.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
