import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../../../core/config/app-config.service';
import {
  asRecord,
  type ParsedWebhook,
  type PaymentProvider,
  type WebhookAction,
  type WebhookRequest,
} from './payment-provider.interface';

/** Payme Merchant API JSON-RPC 2.0 request shape. */
export interface PaymeRpcRequest {
  id: number | string | null;
  method: string;
  params: Record<string, unknown>;
}

/** Payme protocol error codes used by the webhook controller. */
export const PAYME_ERROR = {
  INSUFFICIENT_PRIVILEGE: -32504,
  METHOD_NOT_FOUND: -32601,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_PERFORM: -31008,
  /** Account (invoice) errors live in -31050..-31099. */
  INVOICE_NOT_FOUND: -31050,
  INVOICE_INVALID_STATE: -31051,
} as const;

const METHOD_ACTION: Record<string, WebhookAction> = {
  CheckPerformTransaction: 'check',
  CreateTransaction: 'create',
  PerformTransaction: 'perform',
  CancelTransaction: 'cancel',
  CheckTransaction: 'status',
};

/**
 * Payme (Paycom) Merchant API adapter — JSON-RPC 2.0 over a single webhook URL.
 * Auth: `Authorization: Basic base64("Paycom:" + PAYME_KEY)`.
 * Amounts arrive in tiyin (1 soum = 100 tiyin); account field: `invoice_number`.
 */
@Injectable()
export class PaymeProvider implements PaymentProvider {
  readonly name = 'payme';
  private readonly logger = new Logger(PaymeProvider.name);

  constructor(private readonly config: AppConfigService) {}

  /** Parse an incoming body into the JSON-RPC envelope (never throws). */
  rpcOf(body: unknown): PaymeRpcRequest {
    const b = asRecord(body);
    const id = b.id;
    return {
      id: typeof id === 'number' || typeof id === 'string' ? id : null,
      method: typeof b.method === 'string' ? b.method : '',
      params: asRecord(b.params),
    };
  }

  verifyWebhook(req: WebhookRequest): boolean {
    const key = this.config.env.PAYME_KEY;
    const rawAuth = req.headers['authorization'];
    const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    if (!key) {
      // Sandbox-safe: no credentials configured — verify structurally and log.
      this.logger.warn('PAYME_KEY not configured — structural webhook verification only (sandbox)');
      return this.rpcOf(req.body).method !== '';
    }
    const expected = `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}`;
    return auth === expected;
  }

  parseWebhook(body: unknown): ParsedWebhook {
    const rpc = this.rpcOf(body);
    const account = asRecord(rpc.params.account);
    const rawAmount = rpc.params.amount;
    let amount = '0.00';
    if (typeof rawAmount === 'number' || typeof rawAmount === 'string') {
      try {
        // Payme sends tiyin — convert to soum decimal string.
        amount = new Prisma.Decimal(rawAmount).div(100).toFixed(2);
      } catch {
        amount = '0.00';
      }
    }
    const txId = rpc.params.id;
    return {
      invoiceNumber:
        typeof account.invoice_number === 'string' || typeof account.invoice_number === 'number'
          ? String(account.invoice_number)
          : '',
      amount,
      providerTxId: typeof txId === 'string' || typeof txId === 'number' ? String(txId) : '',
      action: METHOD_ACTION[rpc.method] ?? 'unknown',
    };
  }
}
