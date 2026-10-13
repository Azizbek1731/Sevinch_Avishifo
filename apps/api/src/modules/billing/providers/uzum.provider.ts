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

function str(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/**
 * Uzum Bank merchant adapter — structural stub (spec §M8). Implements the
 * provider-agnostic contract so the webhook endpoint can be wired up when the
 * merchant credentials/protocol details are finalized.
 */
@Injectable()
export class UzumProvider implements PaymentProvider {
  readonly name = 'uzum';
  private readonly logger = new Logger(UzumProvider.name);

  constructor(private readonly config: AppConfigService) {}

  verifyWebhook(_req: WebhookRequest): boolean {
    // No financial callback is trusted until the actual signature protocol is
    // implemented. Structural shape is not proof that money was received.
    if (!this.config.env.SINGLE_CLINIC_MODE) this.logger.warn('Uzum webhook verification is unavailable — rejected');
    return false;
  }

  parseWebhook(body: unknown): ParsedWebhook {
    const b = asRecord(body);
    let amount = '0.00';
    const raw = str(b.amount);
    if (raw !== '') {
      try {
        amount = new Prisma.Decimal(raw).toFixed(2);
      } catch {
        amount = '0.00';
      }
    }
    const rawAction = str(b.action ?? b.operation).toLowerCase();
    const action: WebhookAction =
      rawAction === 'check'
        ? 'check'
        : rawAction === 'create'
          ? 'create'
          : rawAction === 'confirm' || rawAction === 'perform'
            ? 'perform'
            : rawAction === 'cancel' || rawAction === 'reverse'
              ? 'cancel'
              : 'unknown';
    return {
      invoiceNumber: str(b.invoiceNumber ?? b.account),
      amount,
      providerTxId: str(b.transId ?? b.transaction_id),
      action,
    };
  }
}
