import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../../core/config/app-config.service';
import { ClickProvider } from './click.provider';
import { PaymeProvider } from './payme.provider';
import { UzumProvider } from './uzum.provider';

const config = (singleClinic: boolean, withSecrets = false): AppConfigService => ({
  env: { SINGLE_CLINIC_MODE: singleClinic, PAYME_KEY: withSecrets ? 'configured-secret' : undefined, CLICK_SECRET_KEY: withSecrets ? 'configured-secret' : undefined },
}) as AppConfigService;
const clickRequest = { headers: {}, body: { click_trans_id: '123', merchant_trans_id: 'INV-1', action: '0', amount: '100' } };
const paymeRequest = { headers: {}, body: { method: 'CreateTransaction', params: { id: '123', account: { invoice_number: 'INV-1' }, amount: 10000 } } };

describe('cashier-only local payment ingress', () => {
  it('rejects structurally valid unsigned callbacks instead of recording fabricated money', () => {
    expect(new ClickProvider(config(false)).verifyWebhook(clickRequest)).toBe(false);
    expect(new PaymeProvider(config(false)).verifyWebhook(paymeRequest)).toBe(false);
    expect(new UzumProvider(config(false)).verifyWebhook({ headers: {}, body: { transId: '123' } })).toBe(false);
  });
  it('disables external payment callbacks in single-clinic mode even when merchant keys remain configured', () => {
    expect(new ClickProvider(config(true, true)).verifyWebhook(clickRequest)).toBe(false);
    expect(new PaymeProvider(config(true, true)).verifyWebhook({ ...paymeRequest, headers: { authorization: `Basic ${Buffer.from('Paycom:configured-secret').toString('base64')}` } })).toBe(false);
  });
  it('retains authenticated Payme callbacks for explicitly configured multi-clinic installations', () => {
    const provider = new PaymeProvider(config(false, true));
    expect(provider.verifyWebhook(paymeRequest)).toBe(false);
    expect(provider.verifyWebhook({ ...paymeRequest, headers: { authorization: `Basic ${Buffer.from('Paycom:configured-secret').toString('base64')}` } })).toBe(true);
  });
});
