/**
 * Provider-agnostic online payment gateway contract (spec §M8).
 * Each provider (Payme, Click, Uzum) normalizes its webhook payload into a
 * ParsedWebhook so billing can apply payments with one code path.
 */

export type WebhookAction =
  /** Pre-check that the account/invoice can accept the payment. */
  | 'check'
  /** Provider registered a transaction (Payme CreateTransaction / Click prepare). */
  | 'create'
  /** Money confirmed — record the payment (Payme PerformTransaction / Click complete). */
  | 'perform'
  /** Transaction cancelled/rolled back on the provider side. */
  | 'cancel'
  /** Status inquiry (Payme CheckTransaction). */
  | 'status'
  | 'unknown';

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ParsedWebhook {
  /** Our Invoice.number (provider "account"/merchant_trans_id field). */
  invoiceNumber: string;
  /** Decimal string in soum, e.g. "150000.00". */
  amount: string;
  /** Provider-side transaction id (idempotency key for provider payments). */
  providerTxId: string;
  action: WebhookAction;
}

export interface PaymentProvider {
  readonly name: string;
  /** Signature/credentials verification. Sandbox-safe: structural when creds missing. */
  verifyWebhook(req: WebhookRequest): boolean;
  parseWebhook(body: unknown): ParsedWebhook;
}

/** Narrowing helper shared by providers (webhook bodies are untrusted JSON). */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
