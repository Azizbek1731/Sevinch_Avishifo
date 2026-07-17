import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InvoicesService } from './invoices.service';
import { type ProviderTxError } from './invoices.service';
import { asRecord } from './providers/payment-provider.interface';
import { PaymeProvider } from './providers/payme.provider';
import { PAYME_ERROR } from './providers/payme.provider';
import { ClickProvider } from './providers/click.provider';
import { CLICK_ERROR } from './providers/click.provider';
import { Public } from '../../common/decorators';

function paymeErrorCode(error: ProviderTxError): number {
  switch (error) {
    case 'invoice_not_found':
      return PAYME_ERROR.INVOICE_NOT_FOUND;
    case 'invalid_state':
      return PAYME_ERROR.INVOICE_INVALID_STATE;
    case 'wrong_amount':
      return PAYME_ERROR.INVALID_AMOUNT;
    case 'tx_not_found':
      return PAYME_ERROR.TRANSACTION_NOT_FOUND;
    case 'cannot_perform':
    default:
      return PAYME_ERROR.CANNOT_PERFORM;
  }
}

function clickErrorCode(error: ProviderTxError): number {
  switch (error) {
    case 'invoice_not_found':
      return CLICK_ERROR.USER_NOT_FOUND;
    case 'invalid_state':
      return CLICK_ERROR.ALREADY_PAID;
    case 'wrong_amount':
      return CLICK_ERROR.INCORRECT_AMOUNT;
    case 'tx_not_found':
      return CLICK_ERROR.TRANSACTION_NOT_FOUND;
    case 'cannot_perform':
    default:
      return CLICK_ERROR.TRANSACTION_CANCELLED;
  }
}

/**
 * Payment-provider webhooks (spec §M8). Responses are provider-native shapes
 * (Payme JSON-RPC 2.0, Click SHOP-API JSON) — `@Res()` is used deliberately so
 * the global envelope interceptor does not wrap them.
 */
@ApiTags('billing')
@Controller('payments/webhooks')
export class WebhooksController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payme: PaymeProvider,
    private readonly click: ClickProvider,
  ) {}

  // ============================================================ Payme (JSON-RPC 2.0)

  @Public()
  @Post('payme')
  @HttpCode(200)
  async paymeWebhook(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const rpc = this.payme.rpcOf(body);
    const reply = (result: Record<string, unknown>): void => {
      res.json({ jsonrpc: '2.0', id: rpc.id, result });
    };
    const fail = (code: number, message: string): void => {
      res.json({ jsonrpc: '2.0', id: rpc.id, error: { code, message } });
    };

    if (!this.payme.verifyWebhook({ headers, body })) {
      fail(PAYME_ERROR.INSUFFICIENT_PRIVILEGE, 'Insufficient privileges');
      return;
    }

    const parsed = this.payme.parseWebhook(body);
    const method = 'PAYME' as const;

    switch (parsed.action) {
      case 'check': {
        const r = await this.invoices.providerCheckInvoice(parsed.invoiceNumber, parsed.amount);
        if (!r.ok) {
          fail(paymeErrorCode(r.error), `Cannot perform: ${r.error}`);
          return;
        }
        reply({ allow: true });
        return;
      }
      case 'create': {
        const r = await this.invoices.providerCreateTransaction({
          method,
          providerTxId: parsed.providerTxId,
          invoiceNumber: parsed.invoiceNumber,
          amount: parsed.amount,
        });
        if (!r.ok) {
          fail(paymeErrorCode(r.error), `Cannot create transaction: ${r.error}`);
          return;
        }
        reply({ create_time: r.payment.createTime, transaction: r.payment.id, state: r.payment.state });
        return;
      }
      case 'perform': {
        const r = await this.invoices.providerPerformTransaction({ method, providerTxId: parsed.providerTxId });
        if (!r.ok) {
          fail(paymeErrorCode(r.error), `Cannot perform transaction: ${r.error}`);
          return;
        }
        reply({ perform_time: r.payment.performTime, transaction: r.payment.id, state: r.payment.state });
        return;
      }
      case 'cancel': {
        const reasonRaw = asRecord(this.payme.rpcOf(body).params).reason;
        const r = await this.invoices.providerCancelTransaction({
          method,
          providerTxId: parsed.providerTxId,
          reason: typeof reasonRaw === 'number' || typeof reasonRaw === 'string' ? String(reasonRaw) : undefined,
        });
        if (!r.ok) {
          fail(paymeErrorCode(r.error), `Cannot cancel transaction: ${r.error}`);
          return;
        }
        reply({ cancel_time: Date.now(), transaction: r.payment.id, state: r.payment.state });
        return;
      }
      case 'status': {
        const r = await this.invoices.providerGetTransaction({ method, providerTxId: parsed.providerTxId });
        if (!r.ok) {
          fail(paymeErrorCode(r.error), `Transaction not found`);
          return;
        }
        reply({
          create_time: r.payment.createTime,
          perform_time: r.payment.performTime,
          cancel_time: 0,
          transaction: r.payment.id,
          state: r.payment.state,
          reason: null,
        });
        return;
      }
      default:
        fail(PAYME_ERROR.METHOD_NOT_FOUND, 'Method not found');
    }
  }

  // ============================================================ Click (SHOP-API)

  @Public()
  @Post('click')
  @HttpCode(200)
  async clickWebhook(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const b = asRecord(body);
    const echo = {
      click_trans_id: b.click_trans_id ?? null,
      merchant_trans_id: b.merchant_trans_id ?? null,
    };
    const reply = (extra: Record<string, unknown>, error: number, note: string): void => {
      res.json({ ...echo, ...extra, error, error_note: note });
    };

    if (!this.click.verifyWebhook({ headers, body })) {
      reply({}, CLICK_ERROR.SIGN_CHECK_FAILED, 'SIGN CHECK FAILED');
      return;
    }

    const parsed = this.click.parseWebhook(body);
    const method = 'CLICK' as const;

    if (parsed.action === 'create') {
      // prepare (action=0)
      const r = await this.invoices.providerCreateTransaction({
        method,
        providerTxId: parsed.providerTxId,
        invoiceNumber: parsed.invoiceNumber,
        amount: parsed.amount,
      });
      if (!r.ok) {
        reply({}, clickErrorCode(r.error), `Prepare failed: ${r.error}`);
        return;
      }
      reply({ merchant_prepare_id: r.payment.id }, CLICK_ERROR.SUCCESS, 'Success');
      return;
    }

    if (parsed.action === 'perform') {
      // complete (action=1); a negative provider error means rollback.
      const providerError = Number(typeof b.error === 'string' || typeof b.error === 'number' ? b.error : 0);
      if (providerError < 0) {
        const r = await this.invoices.providerCancelTransaction({
          method,
          providerTxId: parsed.providerTxId,
          reason: `click error ${providerError}`,
        });
        reply(
          {},
          r.ok ? CLICK_ERROR.TRANSACTION_CANCELLED : clickErrorCode(r.ok ? 'cannot_perform' : r.error),
          'Transaction cancelled',
        );
        return;
      }
      const r = await this.invoices.providerPerformTransaction({ method, providerTxId: parsed.providerTxId });
      if (!r.ok) {
        reply({}, clickErrorCode(r.error), `Complete failed: ${r.error}`);
        return;
      }
      reply({ merchant_confirm_id: r.payment.id }, CLICK_ERROR.SUCCESS, 'Success');
      return;
    }

    reply({}, CLICK_ERROR.ACTION_NOT_FOUND, 'Action not found');
  }
}
