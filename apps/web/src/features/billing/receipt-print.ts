/**
 * Delay printing until React has painted the receipt. Mark the attempt when
 * the callback runs, not while scheduling: Strict Mode may cancel and schedule
 * the effect again before the first frame has been painted.
 */
export function scheduleReceiptPrint({
  requestId,
  attempted,
  print,
  onError,
}: {
  requestId: string;
  attempted: Set<string>;
  print: () => void;
  onError: () => void;
}): () => void {
  const timer = setTimeout(() => {
    if (attempted.has(requestId)) return;
    attempted.add(requestId);
    try {
      print();
    } catch {
      // The payment already succeeded. Keep its preview available so printing
      // can be retried without submitting the payment again.
      onError();
    }
  }, 250);
  return () => clearTimeout(timer);
}

export interface ReceiptPrintRequest {
  invoiceId: string;
  /** Payment idempotency key: each partial/split submission gets one receipt. */
  requestId: string;
}
