import type { MoneyString } from '../types';

/**
 * Money helpers operating on decimal strings with 2 fraction digits.
 * Internally uses integer tiyin (1 UZS = 100 tiyin) math — safe for
 * UI-side sums; authoritative arithmetic stays server-side (Prisma.Decimal).
 */

export function toTiyin(amount: MoneyString | number): bigint {
  const s = typeof amount === 'number' ? amount.toFixed(2) : amount;
  const m = s.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`Invalid money string: ${s}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = BigInt(m[2] ?? '0');
  const frac = BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return sign * (whole * 100n + frac);
}

export function fromTiyin(tiyin: bigint): MoneyString {
  const sign = tiyin < 0n ? '-' : '';
  const abs = tiyin < 0n ? -tiyin : tiyin;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function addMoney(...amounts: MoneyString[]): MoneyString {
  return fromTiyin(amounts.reduce((acc, a) => acc + toTiyin(a), 0n));
}

export function subMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fromTiyin(toTiyin(a) - toTiyin(b));
}

export function compareMoney(a: MoneyString, b: MoneyString): -1 | 0 | 1 {
  const d = toTiyin(a) - toTiyin(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function isZeroMoney(a: MoneyString): boolean {
  return toTiyin(a) === 0n;
}

/** "1500000.00" → "1 500 000 so'm" (fraction shown only when non-zero). */
export function formatUZS(amount: MoneyString | number, opts?: { withCurrency?: boolean }): string {
  const t = toTiyin(amount);
  const sign = t < 0n ? '-' : '';
  const abs = t < 0n ? -t : t;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = abs % 100n;
  const num = frac === 0n ? `${sign}${whole}` : `${sign}${whole}.${frac.toString().padStart(2, '0')}`;
  return opts?.withCurrency === false ? num : `${num} so'm`;
}
