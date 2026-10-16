'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi } from '../api';
import { scheduleReceiptPrint } from '../receipt-print';
import { ReceiptDocument } from './receipt-document';

export interface ReceiptPrinterProps {
  invoiceId: string;
  checkout?: boolean;
  /** Unique successful submission, including a subsequent partial payment. */
  requestId?: string;
  /** Close the preview after printing, cancelling, or using the manual fallback. */
  onPrinted?: () => void;
}

/** Keep this outside the payment dialog: a settled invoice leaves the queue. */
export function ReceiptPrinter({
  invoiceId,
  requestId,
  onPrinted,
  checkout = false,
}: ReceiptPrinterProps) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const [mountId] = useState(() => crypto.randomUUID());
  const printRequestId = requestId ?? `${mountId}:${invoiceId}`;
  const [printFailed, setPrintFailed] = useState(false);
  const [renderedRequest, setRenderedRequest] = useState<string | null>(null);
  const onReceiptReady = useCallback(() => setRenderedRequest(printRequestId), [printRequestId]);
  const { data, isError, isFetching, refetch } = useQuery({
    // A receipt changes after partial payments, reversals and refunds. A unique
    // submission key prevents the previous payment's cached slip being printed.
    queryKey: ['receipt', checkout ? 'checkout' : 'invoice', invoiceId, printRequestId],
    queryFn: async () =>
      (await (checkout ? billingApi.checkoutReceipt(invoiceId) : billingApi.getReceipt(invoiceId)))
        .data,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const attempted = useRef(new Set<string>());
  const hasData = data !== undefined;
  const ready = hasData && renderedRequest === printRequestId;

  useEffect(() => {
    if (!hasData || ready || isError) return;
    // A remote logo must not hold a paid receipt hostage. Print the receipt
    // without it after three seconds; a late image load keeps the same request
    // identity and cannot start a second automatic print.
    const timer = window.setTimeout(() => setRenderedRequest(printRequestId), 3_000);
    return () => window.clearTimeout(timer);
  }, [hasData, ready, isError, printRequestId]);

  useEffect(() => {
    if (!ready || isError) return;
    setPrintFailed(false);
    return scheduleReceiptPrint({
      requestId: printRequestId,
      attempted: attempted.current,
      print: () => window.print(),
      onError: () => setPrintFailed(true),
    });
  }, [ready, isError, printRequestId]);

  const printManually = () => {
    // A quick manual click can beat the scheduled auto-print frame.
    attempted.current.add(printRequestId);
    try {
      window.print();
      setPrintFailed(false);
    } catch {
      setPrintFailed(true);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onPrinted?.()}>
      <DialogContent className="receipt-preview-dialog sm:max-w-lg">
        <DialogHeader className="print:hidden">
          <DialogTitle>{t('receipt.previewTitle')}</DialogTitle>
          <DialogDescription>{t('receipt.autoPrintHint')}</DialogDescription>
        </DialogHeader>
        {isError ? (
          <div className="space-y-3 py-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              {t('receipt.loadFailed')}
            </p>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('receipt.retry')}
            </Button>
          </div>
        ) : data ? (
          <ReceiptDocument data={data} onReady={onReceiptReady} />
        ) : (
          <div className="space-y-3" aria-busy>
            <p className="text-sm text-muted-foreground">{t('receipt.preparing')}</p>
            <Skeleton className="mx-auto h-80 w-72 max-w-full" />
          </div>
        )}
        {printFailed ? (
          <p role="alert" className="text-sm text-destructive print:hidden">
            {t('receipt.printFailed')}
          </p>
        ) : null}
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={onPrinted}>
            {tc('close')}
          </Button>
          <Button onClick={printManually} disabled={!data || isError}>
            <Printer className="mr-2 h-4 w-4" />
            {t('receipt.print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
