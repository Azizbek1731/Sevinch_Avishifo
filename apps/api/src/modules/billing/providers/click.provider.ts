import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AppConfigService } from '../../../core/config/app-config.service';
import {
  asRecord,
  type ParsedWebhook,
  type PaymentProvider,
  type WebhookRequest,
} from './payment-provider.interface';

/** Click SHOP-API response error codes used by the webhook controller. */
export const CLICK_ERROR = {
  SUCCESS: 0,
  SIGN_CHECK_FAILED: -1,
  INCORRECT_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  USER_NOT_FOUND: -5,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
  ERROR_IN_REQUEST: -8,
  TRANSACTION_CANCELLED: -9,
} as const;

function str(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/**
 * Click SHOP-API adapter — two webhook actions: prepare (action=0) and
 * complete (action=1). `merchant_trans_id` carries our Invoice.number.
 * sign_string = md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id +
 *   [merchant_prepare_id, complete only] + amount + action + sign_time).
 */
@Injectable()
export class ClickProvider implements PaymentProvider {
  readonly name = 'click';
  private readonly logger = new Logger(ClickProvider.name);

  constructor(private readonly config: AppConfigService) {}

  verifyWebhook(req: WebhookRequest): boolean {
    if (this.config.env.SINGLE_CLINIC_MODE) return false;
    const b = asRecord(req.body);
    const secret = this.config.env.CLICK_SECRET_KEY;
    if (!secret) {
      this.logger.warn('CLICK_SECRET_KEY not configured — webhook rejected');
      return false;
    }
    const action = str(b.action);
    const prepareId = action === '1' ? str(b.merchant_prepare_id) : '';
    const base =
      str(b.click_trans_id) +
      str(b.service_id) +
      secret +
      str(b.merchant_trans_id) +
      prepareId +
      str(b.amount) +
      action +
      str(b.sign_time);
    const expected = createHash('md5').update(base).digest('hex');
    return expected === str(b.sign_string);
  }

  parseWebhook(body: unknown): ParsedWebhook {
    const b = asRecord(body);
    let amount = '0.00';
    const raw = str(b.amount);
    if (raw !== '') {
      try {
        // Click sends soum (possibly with decimals) — normalize to 2 fraction digits.
        amount = new Prisma.Decimal(raw).toFixed(2);
      } catch {
        amount = '0.00';
      }
    }
    const action = str(b.action);
    return {
      invoiceNumber: str(b.merchant_trans_id),
      amount,
      providerTxId: str(b.click_trans_id),
      action: action === '0' ? 'create' : action === '1' ? 'perform' : 'unknown',
    };
  }
}
