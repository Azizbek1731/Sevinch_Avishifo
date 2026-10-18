'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ImageUp, Trash2 } from 'lucide-react';
import type { ReceiptSettingsInput } from '@avishifo/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ClinicLogo } from '@/components/print/clinic-logo';
import { ReceiptDocument } from '@/features/billing/components/receipt-document';
import type { ReceiptPayload } from '@/features/billing/api';
import { useAuthStore } from '@/stores/auth-store';
import { settingsApi } from '../api';
import { useApiErrorToast, useHasPermission } from '../hooks';

/** Max logo dimension (px) — downscaled client-side so the data URI stays small. */
const MAX_LOGO_DIM = 320;
/** ~600 KB ceiling on the resulting data URI (server also rejects >800k chars). */
const MAX_LOGO_CHARS = 600_000;

type ReceiptState = Required<
  Pick<
    ReceiptSettingsInput,
    | 'paperWidth'
    | 'fontScale'
    | 'showLogo'
    | 'headerText'
    | 'footerText'
    | 'showTaxId'
    | 'showCashier'
    | 'showPatientMrn'
    | 'showBranch'
  >
>;

const DEFAULT_RECEIPT: ReceiptState = {
  paperWidth: '80',
  fontScale: 'md',
  showLogo: true,
  headerText: '',
  footerText: '',
  showTaxId: true,
  showCashier: true,
  showPatientMrn: false,
  showBranch: true,
};

/** Read + downscale an image file into a compact PNG data URI. */
function fileToLogoDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode-failed'));
      img.onload = () => {
        const w = img.naturalWidth || MAX_LOGO_DIM;
        const h = img.naturalHeight || MAX_LOGO_DIM;
        const scale = Math.min(1, MAX_LOGO_DIM / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas-failed'));
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ReceiptTab() {
  const t = useTranslations('settings');
  const errorToast = useApiErrorToast();
  const queryClient = useQueryClient();
  const canWrite = useHasPermission('clinic.settings.write');
  const fileRef = useRef<HTMLInputElement>(null);
  const activeBranch = useAuthStore((state) =>
    state.branches.find((branch) => branch.id === state.activeBranchId),
  );
  const [previewAt] = useState(() => new Date().toISOString());

  const clinicQuery = useQuery({ queryKey: ['clinic'], queryFn: () => settingsApi.getClinic() });
  const settingsQuery = useQuery({
    queryKey: ['clinic', 'settings'],
    queryFn: () => settingsApi.getSettings(),
  });

  const clinic = clinicQuery.data?.data;
  const settings = settingsQuery.data?.data;

  const [receipt, setReceipt] = useState<ReceiptState>(DEFAULT_RECEIPT);

  useEffect(() => {
    if (!settings) return;
    setReceipt({ ...DEFAULT_RECEIPT, ...(settings.receipt ?? {}) });
  }, [settings]);

  const logoMutation = useMutation({
    mutationFn: (logoUrl: string) => settingsApi.updateClinic({ logoUrl }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinic'] });
      toast.success(t('clinic.saved'));
    },
    onError: errorToast,
  });

  const settingsMutation = useMutation({
    mutationFn: (next: ReceiptState) => settingsApi.updateSettings({ receipt: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinic', 'settings'] });
      toast.success(t('clinic.saved'));
    },
    onError: errorToast,
  });

  const onPickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUri = await fileToLogoDataUri(file);
      if (dataUri.length > MAX_LOGO_CHARS) {
        toast.error(t('receipt.logoTooLarge'));
        return;
      }
      logoMutation.mutate(dataUri);
    } catch {
      toast.error(t('receipt.logoInvalid'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const set = <K extends keyof ReceiptState>(key: K, value: ReceiptState[K]) =>
    setReceipt((prev) => ({ ...prev, [key]: value }));

  if (clinicQuery.isLoading || settingsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const logoUrl = clinic?.logoUrl ?? null;
  // This is a render-only fixture: editing settings never creates an invoice or payment.
  const preview: ReceiptPayload = {
    clinic: clinic ?? null,
    branch: activeBranch ? { name: activeBranch.name, address: null, phone: null } : null,
    receipt,
    invoice: {
      id: 'receipt-preview',
      number: 'INV-2026-000123',
      branchId: activeBranch?.id ?? '',
      patientId: 'preview-patient',
      visitId: null,
      status: 'PAID',
      subtotal: '330000.00',
      discountTotal: '0.00',
      total: '330000.00',
      paidTotal: '330000.00',
      due: '0.00',
      note: null,
      issuedAt: previewAt,
      createdById: 'preview-user',
      createdAt: previewAt,
      updatedAt: previewAt,
    },
    patient: { id: 'preview-patient', mrn: 'MRN-000123', fullName: 'Aliyev A.' },
    lines: [
      {
        id: 'preview-line-1',
        serviceId: null,
        title: t('receipt.previewService1'),
        quantity: 1,
        unitPrice: '150000.00',
        discount: '0.00',
        lineTotal: '150000.00',
        performerUserId: null,
      },
      {
        id: 'preview-line-2',
        serviceId: null,
        title: t('receipt.previewService2'),
        quantity: 2,
        unitPrice: '90000.00',
        discount: '0.00',
        lineTotal: '180000.00',
        performerUserId: null,
      },
    ],
    payments: [
      {
        id: 'preview-payment',
        invoiceId: 'receipt-preview',
        branchId: activeBranch?.id ?? '',
        amount: '330000.00',
        method: 'CASH',
        status: 'COMPLETED',
        note: null,
        shiftId: null,
        providerTxId: null,
        receivedById: null,
        paidAt: previewAt,
        createdAt: previewAt,
      },
    ],
    totals: {
      subtotal: '330000.00',
      discountTotal: '0.00',
      total: '330000.00',
      paidTotal: '330000.00',
      due: '0.00',
    },
    printedAt: previewAt,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Logo */}
        <Card>
          <CardHeader>
            <CardTitle>{t('receipt.logo')}</CardTitle>
            <CardDescription>{t('receipt.logoHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-20 w-48 items-center justify-center overflow-hidden rounded-md border bg-white p-2">
                {logoUrl ? (
                  <ClinicLogo
                    src={logoUrl}
                    alt={clinic?.name ?? ''}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <ImageUp className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => void onPickLogo(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canWrite || logoMutation.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageUp className="mr-1 h-4 w-4" />
                  {t('receipt.uploadLogo')}
                </Button>
                {logoUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive"
                    disabled={!canWrite || logoMutation.isPending}
                    onClick={() => logoMutation.mutate('')}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    {t('receipt.removeLogo')}
                  </Button>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Receipt options */}
        <Card>
          <CardHeader>
            <CardTitle>{t('receipt.title')}</CardTitle>
            <CardDescription>{t('receipt.desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('receipt.paperWidth')}</Label>
                <Select
                  value={receipt.paperWidth}
                  onValueChange={(v) => set('paperWidth', v as '58' | '80')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">{t('receipt.paper58')}</SelectItem>
                    <SelectItem value="80">{t('receipt.paper80')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('receipt.fontScale')}</Label>
                <Select
                  value={receipt.fontScale}
                  onValueChange={(v) => set('fontScale', v as 'sm' | 'md' | 'lg')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sm">{t('receipt.fontSm')}</SelectItem>
                    <SelectItem value="md">{t('receipt.fontMd')}</SelectItem>
                    <SelectItem value="lg">{t('receipt.fontLg')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rc-header">{t('receipt.headerText')}</Label>
              <Textarea
                id="rc-header"
                rows={2}
                maxLength={200}
                placeholder={t('receipt.headerHint')}
                value={receipt.headerText}
                onChange={(e) => set('headerText', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rc-footer">{t('receipt.footerText')}</Label>
              <Textarea
                id="rc-footer"
                rows={2}
                maxLength={300}
                placeholder={t('receipt.footerHint')}
                value={receipt.footerText}
                onChange={(e) => set('footerText', e.target.value)}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              {(
                [
                  ['showLogo', 'showLogo'],
                  ['showBranch', 'showBranch'],
                  ['showTaxId', 'showTaxId'],
                  ['showCashier', 'showCashier'],
                  ['showPatientMrn', 'showPatientMrn'],
                ] as const
              ).map(([key, labelKey]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={`rc-${key}`} className="font-normal">
                    {t(`receipt.${labelKey}` as never)}
                  </Label>
                  <Switch
                    id={`rc-${key}`}
                    checked={receipt[key]}
                    onCheckedChange={(v) => set(key, v)}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!canWrite || settingsMutation.isPending}
                onClick={() => settingsMutation.mutate(receipt)}
              >
                {t('form.save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live preview */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{t('receipt.preview')}</p>
        <ReceiptDocument data={preview} />
      </div>
    </div>
  );
}
