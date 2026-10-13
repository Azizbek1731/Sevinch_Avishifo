import { PaymentMethod, toTiyin } from '@avishifo/shared';
import { SINGLE_CLINIC_MODE } from '../../lib/deployment';

/** External accounts accepted by the clinic's cashier. BALANCE is internal credit. */
export const CLINIC_PAYMENT_METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.CLICK,
] as const;
export const EXTERNAL_PAYMENT_METHODS = SINGLE_CLINIC_MODE
  ? [...CLINIC_PAYMENT_METHODS]
  : Object.values(PaymentMethod).filter((method) => method !== PaymentMethod.BALANCE);
export const INVOICE_PAYMENT_METHODS = [...EXTERNAL_PAYMENT_METHODS, PaymentMethod.BALANCE];

/** A partially typed amount must never crash a money-entry form. */
export function inputTiyin(value: string): bigint | null {
  try {
    return toTiyin(value);
  } catch {
    return null;
  }
}

export function needsOpenShift(method: PaymentMethod): boolean {
  return method === PaymentMethod.CASH || (SINGLE_CLINIC_MODE && method !== PaymentMethod.BALANCE);
}
