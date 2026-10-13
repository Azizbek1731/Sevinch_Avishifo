import { fromTiyin, toTiyin } from '@avishifo/shared';

/** UI preview uses the same half-up rounding at the currency's smallest unit. */
export function payoutPreview(
  fee: string,
  type: 'PERCENT' | 'FIXED',
  value: string,
): string | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  try {
    const amount = toTiyin(value);
    if (amount <= 0n || (type === 'PERCENT' && amount > 10000n)) return null;
    return type === 'FIXED'
      ? fromTiyin(amount)
      : fromTiyin((toTiyin(fee) * amount + 5000n) / 10000n);
  } catch {
    return null;
  }
}
export function usagePreview(quantity: string, price: string): string | null {
  if (!/^\d+(?:\.\d{1,3})?$/.test(quantity) || !/^\d+(?:\.\d{1,2})?$/.test(price)) return null;
  try {
    const [whole = '0', part = ''] = quantity.split('.');
    const milli = BigInt(whole) * 1000n + BigInt(part.padEnd(3, '0'));
    if (milli <= 0n) return null;
    return fromTiyin((milli * toTiyin(price) + 500n) / 1000n);
  } catch {
    return null;
  }
}
