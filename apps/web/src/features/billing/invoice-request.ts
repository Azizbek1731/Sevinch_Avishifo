import type { QuickInvoiceInput } from '@avishifo/shared';
import { createId } from '@/lib/id';

export interface InvoiceRequestIdentity {
  fingerprint: string;
  key: string;
}

/** Retries of unchanged form data reuse one identity; edited orders start a new one. */
export function identifyInvoiceRequest(
  payload: Omit<QuickInvoiceInput, 'idempotencyKey'>,
  previous: InvoiceRequestIdentity | null,
): InvoiceRequestIdentity {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: createId() };
}
