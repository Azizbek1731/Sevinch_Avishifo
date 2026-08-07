'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../api';
import { ReceiptDocument } from './receipt-document';

export interface ReceiptPrinterProps {
  invoiceId: string;
  /** Called once the print dialog has been dismissed (or printing failed). */
  onPrinted?: () => void;
}

/**
 * Mount after a paid sale to push the receipt straight to the printer without
 * leaving the current screen: the receipt renders off-screen and the print
 * stylesheet promotes it to the page. Unmount on `onPrinted`.
 */
export function ReceiptPrinter({ invoiceId, onPrinted }: ReceiptPrinterProps) {
  const { data, isError } = useQuery({
    queryKey: ['invoices', invoiceId, 'receipt'],
    queryFn: async () => (await billingApi.getReceipt(invoiceId)).data,
  });

  const printed = useRef(false);
  useEffect(() => {
    if (isError) {
      onPrinted?.();
      return;
    }
    if (!data || printed.current) return;
    printed.current = true;
    // One frame so the off-screen receipt is painted before the dialog opens.
    const timer = window.setTimeout(() => {
      window.print();
      onPrinted?.();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [data, isError, onPrinted]);

  if (!data) return null;

  return (
    <div aria-hidden className="print-offscreen">
      <ReceiptDocument data={data} />
    </div>
  );
}
