'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatUZS, toTiyin } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { ReceiptPayload, ReceiptSettings } from '../api';

/**
 * Receipt-body font size, per paper width and the clinic's fontScale setting.
 *
 * Font size and paper width are one decision, not two. A 58mm roll prints 48mm
 * wide, and a monospace glyph advances about 0.6em — so 10px gives roughly the
 * 30-odd characters per line a thermal printer natively lays down, while the
 * 13px that looked right on screen fits barely 23 and wrapped service names and
 * amounts onto extra lines. 80mm paper has half again the width and can carry
 * the larger sizes.
 */
const FONT_SCALE: Record<'58' | '80', Record<NonNullable<ReceiptSettings['fontScale']>, string>> = {
  '58': { sm: 'text-[9px]', md: 'text-[10px]', lg: 'text-[11px]' },
  '80': { sm: 'text-[11px]', md: 'text-[12px]', lg: 'text-[13px]' },
};

/** A full-width rule made of dashes — a thermal head renders these crisply. */
function Rule() {
  return (
    <div aria-hidden className="my-1 overflow-hidden whitespace-nowrap leading-none">
      ------------------------------------------------------------
    </div>
  );
}

/**
 * One `label ......... amount` line.
 *
 * The amount is the part that must never wrap: a total broken across two lines
 * reads as two different numbers. So the label may shrink and ellipsise while
 * the figure keeps its own line to itself.
 */
function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-2', strong && 'receipt-strong font-bold')}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Thermal receipt body, styled from the clinic's receipt settings (Sozlamalar →
 * Chek). Rendered on the receipt page and — off-screen — by <ReceiptPrinter />
 * right after a front-desk sale, so both paths print the same customized slip.
 * The `print-area` class is what the global print stylesheet keeps visible;
 * `receipt-print` is what forces it to pure black and drops the on-screen card.
 */
export function ReceiptDocument({ data }: { data: ReceiptPayload }) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const user = useAuthStore((s) => s.user);

  // Receipt customization (clinic settings) with sensible defaults.
  const rc: ReceiptSettings = data.receipt ?? {};
  const paper = rc.paperWidth === '58' ? '58' : '80';
  const paperWidth = `${paper}mm`;
  const fontClass = FONT_SCALE[paper][rc.fontScale ?? 'md'];
  const showLogo = rc.showLogo !== false && Boolean(data.clinic?.logoUrl);
  const showBranch = rc.showBranch !== false;
  const showTaxId = rc.showTaxId !== false;
  const showCashier = rc.showCashier !== false;
  const showPatientMrn = rc.showPatientMrn === true;
  const headerText = rc.headerText?.trim();
  const footerText = rc.footerText?.trim() || t('receipt.thanks');

  const money = (v: string): string => formatUZS(v, { withCurrency: false });
  // Rows that are zero carry no information on a paper slip; a "Chegirma 0"
  // line is just one more thing between the customer and the total.
  const hasDiscount = toTiyin(data.totals.discountTotal) > 0n;
  const hasDue = toTiyin(data.totals.due) > 0n;

  return (
    <>
      {/*
        Zero page margin, overriding the 12mm the A4 documents need: a 58mm roll
        prints 48mm wide, and giving 12mm of that back to margins left barely
        half the strip and wrapped every amount onto its own line.

        The page SIZE is deliberately not set here. `size: 48mm auto` is invalid
        CSS — a length cannot be paired with `auto` — and any fixed height would
        paginate a long receipt onto a second sheet. The roll width and length
        come from the printer queue instead, which is the only place that knows
        the actual paper.
      */}
      <style>{`@media print { @page { margin: 0 } }`}</style>

      <div
        className={cn(
          'print-area receipt-print mx-auto w-full bg-card p-3 font-mono leading-snug text-foreground',
          // The card framing is a screen affordance so the preview reads as a
          // slip; print strips it back to bare paper.
          'rounded-md border print:rounded-none print:border-0 print:p-0',
          fontClass,
        )}
        style={{ maxWidth: paperWidth }}
      >
        <div className="space-y-0.5 text-center">
          {showLogo && data.clinic?.logoUrl ? (
            <img
              src={data.clinic.logoUrl}
              alt={data.clinic?.name ?? ''}
              /* Small and centred: a large logo dithers into a grey smear. */
              className="mx-auto mb-1 max-h-10 w-auto object-contain"
            />
          ) : null}
          <p className="receipt-strong text-[1.15em] font-bold uppercase leading-tight">
            {data.clinic?.name ?? ''}
          </p>
          {headerText ? <p className="whitespace-pre-line">{headerText}</p> : null}
          {showBranch && data.branch ? <p>{data.branch.name}</p> : null}
          {showBranch && data.branch?.address ? (
            <p className="leading-tight">{data.branch.address}</p>
          ) : null}
          {showBranch && data.branch?.phone ? <p>{data.branch.phone}</p> : null}
          {showTaxId && data.clinic?.taxId ? (
            <p>
              {t('receipt.taxId')}: {data.clinic.taxId}
            </p>
          ) : null}
        </div>

        <Rule />

        <div>
          <Row label={t('receipt.receiptNo')} value={data.invoice.number} strong />
          <Row label={t('receipt.date')} value={formatTz(data.printedAt)} />
          <Row
            label={t('receipt.patient')}
            value={
              showPatientMrn ? `${data.patient.fullName} · ${data.patient.mrn}` : data.patient.fullName
            }
          />
          {showCashier && user ? <Row label={t('receipt.cashier')} value={user.fullName} /> : null}
        </div>

        <Rule />

        <div className="space-y-1">
          {data.lines.map((l) => (
            <div key={l.id}>
              {/* The name gets its own line so it can wrap without ever pushing
                  the figures around. */}
              <p className="leading-tight">{localizedText(l.title, locale)}</p>
              <Row
                label={`${l.quantity} × ${money(l.unitPrice)}`}
                value={money(l.lineTotal)}
              />
            </div>
          ))}
        </div>

        <Rule />

        <div>
          <Row label={t('receipt.subtotal')} value={money(data.totals.subtotal)} />
          {hasDiscount ? (
            <Row label={t('receipt.discount')} value={`− ${money(data.totals.discountTotal)}`} />
          ) : null}
          <Row
            label={t('receipt.total')}
            value={formatUZS(data.totals.total)}
            strong
          />
          <Row label={t('receipt.paid')} value={money(data.totals.paidTotal)} />
          {hasDue ? <Row label={t('receipt.due')} value={money(data.totals.due)} strong /> : null}
        </div>

        {data.payments.length > 0 ? (
          <>
            <Rule />
            <div>
              {/* Which method covered how much — the whole point when a bill is
                  split across cash and a card. The timestamp is dropped: the
                  receipt is already dated at the top. */}
              {data.payments.map((p) => (
                <Row key={p.id} label={t(`methods.${p.method}`)} value={money(p.amount)} />
              ))}
            </div>
          </>
        ) : null}

        <Rule />
        <p className="whitespace-pre-line text-center leading-tight">{footerText}</p>

        {/* Blank tail so the tear-off edge falls clear of the last line. */}
        <div aria-hidden className="h-0 print:h-10" />
      </div>
    </>
  );
}
