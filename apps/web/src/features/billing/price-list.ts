import { fromTiyin, toTiyin, type MoneyString } from '@avishifo/shared';

/**
 * Partner tariff at the desk: the catalogue price stays on the line and the
 * gap is billed as a discount, so a later change to the list never rewrites
 * an already issued invoice.
 *
 * A missing or non-reducing list price leaves the catalogue price as-is.
 */
export function listedLine(
  catalogPrice: string | null | undefined,
  listPrice: string | null | undefined,
  quantity: number,
): { unitPrice: MoneyString; discount: MoneyString } {
  const catalog = toTiyin(catalogPrice && catalogPrice !== '' ? catalogPrice : '0');
  const qty = BigInt(Math.max(1, Math.trunc(Number.isFinite(quantity) ? quantity : 1)));
  if (listPrice === null || listPrice === undefined || listPrice === '') {
    return { unitPrice: fromTiyin(catalog), discount: fromTiyin(0n) };
  }
  const listed = toTiyin(listPrice);
  if (listed >= catalog) {
    return { unitPrice: fromTiyin(catalog), discount: fromTiyin(0n) };
  }
  return { unitPrice: fromTiyin(catalog), discount: fromTiyin((catalog - listed) * qty) };
}
