'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { formatUZS, fromTiyin, toTiyin, type MoneyString } from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from '@/i18n/routing';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PatientCombobox } from '@/features/billing/components/patient-combobox';
import { billingApi, sanitizeMoney, type PatientBrief } from '@/features/billing/api';
import { useApiErrorToast } from '@/features/billing/hooks';
import { clinicalOrdersApi } from '@/features/clinical-orders/api';
import { identifyInvoiceRequest, type InvoiceRequestIdentity } from '@/features/billing/invoice-request';

const NONE = '__none__';

export function ManualEntryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('reception.manualEntry');
  const tc = useTranslations('common');
  const tb = useTranslations('billing');
  const errorToast = useApiErrorToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const branchId = useAuthStore((s) => s.activeBranchId);
  const titleId = useId();
  const priceId = useId();
  const noteId = useId();

  const [patient, setPatient] = useState<PatientBrief | null>(null);
  const [doctorId, setDoctorId] = useState<string>(NONE);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const requestIdentity = useRef<InvoiceRequestIdentity | null>(null);

  const doctors = useQuery({
    queryKey: ['clinical-orders', 'doctors', branchId],
    queryFn: async () => (await clinicalOrdersApi.doctors()).data,
    enabled: open && Boolean(branchId),
  });

  useEffect(() => {
    if (!open) return;
    setPatient(null);
    setDoctorId(NONE);
    setTitle('');
    setPrice('');
    setNote('');
    requestIdentity.current = null;
  }, [open]);

  const unitPrice = sanitizeMoney(price) || '0';
  let totalLabel = formatUZS('0');
  try {
    totalLabel = formatUZS(fromTiyin(toTiyin(unitPrice as MoneyString)));
  } catch {
    totalLabel = formatUZS('0');
  }

  const canSubmit =
    Boolean(branchId && patient?.id && title.trim() && unitPrice !== '0') &&
    (() => {
      try {
        return toTiyin(unitPrice as MoneyString) > 0n;
      } catch {
        return false;
      }
    })();

  const submit = useMutation({
    mutationFn: async () => {
      if (!branchId || !patient) throw new Error('missing');
      const trimmedTitle = title.trim();
      const trimmedNote = note.trim();
      const payload = {
        patientId: patient.id,
        branchId,
        settle: 'DEBT' as const,
        cashierOnly: true as const,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        lines: [
          {
            title: trimmedTitle,
            quantity: 1,
            unitPrice: unitPrice as MoneyString,
            discount: '0' as MoneyString,
            ...(doctorId !== NONE ? { performerUserId: doctorId } : {}),
          },
        ],
      };
      requestIdentity.current = identifyInvoiceRequest(payload, requestIdentity.current);
      return billingApi.quickInvoice({
        ...payload,
        idempotencyKey: requestIdentity.current.key,
      });
    },
    onSuccess: (res) => {
      const invoice = res.data.invoice;
      toast.success(tb('quick.sentToCashier', { number: invoice.number }), {
        action: {
          label: tb('quick.viewInvoice'),
          onClick: () => router.push(`/invoices/${invoice.id}`),
        },
      });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      requestIdentity.current = null;
      onOpenChange(false);
    },
    onError: errorToast,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('patient')}</Label>
            <PatientCombobox value={patient} onChange={setPatient} clearable allowCreate />
          </div>

          <div className="space-y-2">
            <Label>{t('doctor')}</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder={t('doctorOptional')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('doctorNone')}</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.fullName}
                    {doctor.specialty ? ` — ${doctor.specialty}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('doctorHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={titleId}>{t('procedure')}</Label>
            <Input
              id={titleId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('procedurePlaceholder')}
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={priceId}>{t('price')}</Label>
            <Input
              id={priceId}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              {t('total')}: {totalLabel}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={noteId}>{t('note')}</Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('notePlaceholder')}
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? tc('loading') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
