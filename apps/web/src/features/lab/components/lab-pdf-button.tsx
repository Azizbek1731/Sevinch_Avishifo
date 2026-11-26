'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { usePdfPrinted } from '@/lib/pdf-printed';

/** Lab result PDF download — turns green after a successful take/print. */
export function LabPdfButton({
  orderId,
  orderNumber,
  size = 'sm',
  label = 'PDF',
  failMessage,
}: {
  orderId: string;
  orderNumber: string;
  size?: 'default' | 'sm';
  label?: string;
  failMessage?: string;
}) {
  const t = useTranslations('lab');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const printed = usePdfPrinted('lab', orderId);

  return (
    <Button
      type="button"
      size={size}
      variant={printed.printed ? 'default' : 'outline'}
      className={printed.className}
      disabled={busy}
      title={printed.printed ? t('pdfPrinted') : undefined}
      onClick={() => {
        void (async () => {
          setBusy(true);
          try {
            const blob = await api.get<Blob>(`/lab-orders/${orderId}/pdf`, { locale });
            const url = URL.createObjectURL(blob.data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `natija-${orderNumber}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            printed.markPrinted();
          } catch {
            toast.error(failMessage ?? t('pdfFailed'));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <FileDown className={size === 'sm' ? 'mr-1 h-4 w-4' : 'h-4 w-4'} />
      {label}
    </Button>
  );
}
