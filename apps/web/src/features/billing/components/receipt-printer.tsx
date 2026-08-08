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
    // Outside the ['invoices'] prefix on purpose: a paid receipt never
    // changes, and sitting under that prefix meant every sale invalidated and
    // refetched it for no reason.
    queryKey: ['receipt', invoiceId],
    staleTime: Infinity,
    queryFn: async () => (await billingApi.getReceipt(invoiceId)).data,
  });

  // Held in a ref so a new inline callback from the parent cannot retrigger the
  // effect below. The parent re-renders several times right after a sale — the
  // toast, the dialog closing, four query invalidations — and each one used to
  // tear the pending print down.
  const onPrintedRef = useRef(onPrinted);
  onPrintedRef.current = onPrinted;

  // Keyed by invoice, not by mount. When a print is lost the parent never
  // clears printInvoiceId, so this component stays mounted and the next sale
  // arrives as a prop change rather than a remount — a per-mount flag would
  // then suppress every receipt for the rest of the session.
  const printedFor = useRef<string | null>(null);

  // A boolean, deliberately, rather than `data` itself: invalidateBilling()
  // invalidates the `['invoices']` prefix, which matches this receipt query, so
  // `data` gets a fresh identity on every refetch. Depending on the object
  // re-ran the effect mid-flight, the cleanup cancelled the timer, and the
  // guard then blocked it from ever being rescheduled — the receipt was simply
  // never printed.
  const ready = data !== undefined;

  useEffect(() => {
    if (printedFor.current === invoiceId) return;
    if (isError) {
      printedFor.current = invoiceId;
      onPrintedRef.current?.();
      return;
    }
    if (!ready) return;
    printedFor.current = invoiceId;
    // One frame so the off-screen receipt is painted before the dialog opens.
    const timer = window.setTimeout(() => {
      window.print();
      onPrintedRef.current?.();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [ready, isError, invoiceId]);

  if (!data) return null;

  return (
    <div aria-hidden className="print-offscreen">
      <ReceiptDocument data={data} />
    </div>
  );
}
