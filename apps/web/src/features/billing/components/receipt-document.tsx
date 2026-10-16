'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatUZS, toTiyin } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { ReceiptPayload, ReceiptSettings } from '../api';
import { ThermalLogo } from './thermal-logo';

/**
 * Receipt-body font size, per paper width and the clinic's fontScale setting.
 *
 * Font size and paper width are one decision, not two. A 58mm roll prints 48mm
 * wide and a monospace glyph advances about 0.6em, so the size directly sets
 * how many characters fit: 11px gives 27 per line, 15px gives 20.
 *
 * These tiers are deliberately larger than the ~32 characters a thermal printer
 * lays down natively: a receipt is read at arm's length across a counter, often
 * by someone who did not bring their glasses. But the ceiling is real. At 16px
 * a 48mm strip carries 18 characters, which is fewer than "To'langan  130 000"
 * needs, and every money row then breaks in half. 15px buys 19 and is the most
 * a 58mm roll will take while keeping a label and its figure side by side.
 */
const FONT_SCALE: Record<'58' | '80', Record<NonNullable<ReceiptSettings['fontScale']>, string>> = {
  '58': { sm: 'text-[12px]', md: 'text-[13px]', lg: 'text-[15px]' },
  '80': { sm: 'text-[14px]', md: 'text-[16px]', lg: 'text-[18px]' },
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
 * Neither half may be broken: an amount split across two lines reads as two
 * different numbers, and a label clipped to "Che…" tells the reader nothing. So
 * when the pair will not fit the strip — which is often, at the larger sizes on
 * 58mm paper — the value drops to its own line and stays right-aligned there,
 * rather than either side being cut.
 */
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline justify-between gap-x-2',
        strong && 'receipt-strong font-bold',
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span className="ml-auto whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Thermal receipt body, styled from the clinic's receipt settings (Sozlamalar →
 * Chek). Rendered on the receipt page and in <ReceiptPrinter /> immediately
 * after payment, so both paths print the same customized slip.
 * The `print-area` class is what the global print stylesheet keeps visible;
 * `receipt-print` is what forces it to pure black and drops the on-screen card.
 */
export function ReceiptDocument({ data, onReady }: { data: ReceiptPayload; onReady?: () => void }) {
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

  useEffect(() => {
    if (!showLogo) onReady?.();
  }, [showLogo, onReady]);

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
          'print-area print-flow receipt-print mx-auto w-full bg-card p-3 font-mono leading-snug text-foreground',
          // The card framing is a screen affordance so the preview reads as a
          // slip; print strips it back to bare paper.
          'rounded-md border print:rounded-none print:border-0 print:p-0',
          fontClass,
        )}
        style={{ maxWidth: paperWidth }}
      >
        <div className="space-y-0.5 text-center">
          {showLogo && data.clinic?.logoUrl ? (
            <ThermalLogo
              src={data.clinic.logoUrl}
              alt={data.clinic?.name ?? ''}
              onReady={onReady}
              /*
               * Constrained by WIDTH, not height. Clinic logos are usually wide
               * — a mark beside a name — and capping the height squeezed one to
               * about two thirds of the strip, which is where the lettering
               * inside it stopped being readable. The height cap is only a
               * guard for the rare tall logo.
               */
              className="mx-auto mb-1 h-auto max-h-24 w-full object-contain"
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

        {/*
          Not a two-column block. At the larger sizes a 48mm strip carries about
          twenty characters, and "Chek №" beside a fifteen-character invoice
          number does not fit in that — laid out as a row it pushed every value
          onto its own line anyway, just without saying so. The number is the
          thing a customer quotes back, so it leads, and the rest reads as
          ordinary sentences that wrap where they need to.
        */}
        <p className="text-center leading-tight">{t('receipt.receiptNo')}</p>
        {/* Never broken: half an invoice number on each of two lines is not an
            invoice number. */}
        <p className="receipt-strong whitespace-nowrap text-center font-bold">
          {data.invoice.number}
        </p>
        <p className="text-center">{formatTz(data.printedAt)}</p>
        <p className="mt-1 leading-tight">
          {t('receipt.patient')}: {data.patient.fullName}
          {showPatientMrn ? ` · ${data.patient.mrn}` : ''}
        </p>
        {showCashier && user ? (
          <p className="leading-tight">
            {t('receipt.cashier')}: {user.fullName}
          </p>
        ) : null}

        <Rule />

        {data.checkout ? (
          <div className="mb-2 break-words text-[0.85em]">
            {data.checkout.invoices.map((invoice) => invoice.number).join(' · ')}
          </div>
        ) : null}
        <div className="space-y-1">
          {data.lines.map((l) => (
            <div key={l.id} className="receipt-line">
              {/* The name gets its own line so it can wrap without ever pushing
                  the figures around. */}
              <p className="leading-tight">{localizedText(l.title, locale)}</p>
              {l.quantity === 1 ? (
                // A single unit needs no "1 ×" — just the price, under the name.
                <p className="text-right tabular-nums">{money(l.lineTotal)}</p>
              ) : (
                <Row label={`${l.quantity} × ${money(l.unitPrice)}`} value={money(l.lineTotal)} />
              )}
            </div>
          ))}
        </div>

        <Rule />

        <div className="receipt-totals">
          {/* With no discount the subtotal is the total said twice, and it owns
              the longest label on the slip — so it only appears when it differs. */}
          {hasDiscount ? (
            <Row label={t('receipt.subtotal')} value={money(data.totals.subtotal)} />
          ) : null}
          {hasDiscount ? (
            <Row label={t('receipt.discount')} value={`− ${money(data.totals.discountTotal)}`} />
          ) : null}
          <Row label={t('receipt.total')} value={formatUZS(data.totals.total)} strong />
          {data.checkout ? (
            <>
              {toTiyin(data.checkout.paidBefore) > 0n ? (
                <Row label={t('checkout.previouslyPaid')} value={money(data.checkout.paidBefore)} />
              ) : null}
              <Row label={t('checkout.paidNow')} value={money(data.checkout.amount)} strong />
            </>
          ) : (
            <Row label={t('receipt.paid')} value={money(data.totals.paidTotal)} />
          )}
          {hasDue ? <Row label={t('receipt.due')} value={money(data.totals.due)} strong /> : null}
        </div>

        {data.payments.length > 0 ? (
          <>
            <Rule />
            <div>
              {/* Which method covered how much — the whole point when a bill is
                  split across cash and a card. The timestamp is dropped: the
                  receipt is already dated at the top. */}
              {data.payments
                .filter((p) => p.status === 'COMPLETED')
                .map((p) => (
                  <div key={p.id} className="break-inside-avoid">
                    <Row label={t(`methods.${p.method}`)} value={money(p.amount)} />
                    {p.note ? (
                      <p className="mb-1 whitespace-pre-wrap break-words text-[0.9em]">
                        {t('pay.note')}: {p.note}
                      </p>
                    ) : null}
                  </div>
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
