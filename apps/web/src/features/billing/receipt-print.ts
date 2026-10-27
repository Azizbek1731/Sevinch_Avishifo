/**
 * Delay printing until React has painted the receipt. Deduplicate across
 * remounts (Strict Mode, dialog re-open) with a module-level set — a useRef
 * Set is wiped when the printer component remounts and used to fire twice.
 */
const attemptedPrints = new Set<string>();
let printInFlight = false;

export function scheduleReceiptPrint({
  requestId,
  attempted,
  print,
  onError,
  delayMs = 400,
}: {
  requestId: string;
  /** Optional local set kept for tests; production relies on the module lock. */
  attempted?: Set<string>;
  print: () => void;
  onError: () => void;
  delayMs?: number;
}): () => void {
  const timer = globalThis.setTimeout(() => {
    if (attemptedPrints.has(requestId) || attempted?.has(requestId) || printInFlight) return;
    // A second window.print while the system dialog is open often yields a
    // blank second slip on 80mm thermal drivers — or cancels the first job.
    if (
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('print').matches
    ) {
      return;
    }
    attemptedPrints.add(requestId);
    attempted?.add(requestId);
    printInFlight = true;
    const release = () => {
      printInFlight = false;
      if (typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('afterprint', release);
      }
    };
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('afterprint', release);
    }
    // Safety: some drivers never fire afterprint.
    globalThis.setTimeout(release, 8_000);
    try {
      print();
    } catch {
      release();
      // The payment already succeeded. Keep its preview available so printing
      // can be retried without submitting the payment again.
      onError();
    }
  }, delayMs);
  return () => globalThis.clearTimeout(timer);
}

/** Allow an explicit "Chop etish" / reprint for the same slip. */
export function allowReceiptReprint(requestId: string): void {
  attemptedPrints.delete(requestId);
  printInFlight = false;
}

export interface ReceiptPrintRequest {
  invoiceId: string;
  /** Payment idempotency key: each partial/split submission gets one receipt. */
  requestId: string;
}
