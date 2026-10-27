'use client';

import { Fragment, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatUZS, fromTiyin, toTiyin } from '@avishifo/shared';
import { formatTz } from '@/lib/dates';
import { localizedText } from '@/lib/localized';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { formatClinicPhone } from '@/components/print/clinic-letterhead';
import type { ReceiptPayload, ReceiptSettings } from '../api';
import { ThermalLogo } from './thermal-logo';

/**
 * Receipt-body font size, per paper width and the clinic's fontScale setting.
 *
 * Font size and printable width are one decision. An 80mm roll burns ~72mm;
 * a 58mm roll burns ~48mm. A monospace glyph advances about 0.6em, so the size
 * directly sets how many characters fit on the printable strip.
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
  '80': { sm: 'text-[12px]', md: 'text-[14px]', lg: 'text-[15px]' },
};

/** Printable content width (thermal head), not the roll's physical width. */
const PRINTABLE_WIDTH_MM: Record<'58' | '80', number> = {
  '58': 48,
  '80': 72,
};

/** Full-width rule — CSS border stays inside the printable strip (dash glyphs do not). */
function Rule() {
  return <div aria-hidden className="my-1.5 w-full border-t border-dashed border-black" />;
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
  const contentWidth = `${PRINTABLE_WIDTH_MM[paper]}mm`;
  const fontClass = FONT_SCALE[paper][rc.fontScale ?? 'md'];
  const showLogo = rc.showLogo !== false && Boolean(data.clinic?.logoUrl);
  const showBranch = rc.showBranch !== false;
  const showTaxId = rc.showTaxId !== false;
  const showCashier = rc.showCashier !== false;
  const showPatientMrn = rc.showPatientMrn === true;
  const headerText = rc.headerText?.trim();
  const footerText = rc.footerText?.trim() || t('receipt.thanks');
  const clinicName = data.clinic?.name?.trim() || data.clinic?.legalName?.trim() || '';
  const branchName = showBranch && data.branch?.name !== clinicName ? data.branch?.name : null;
  const address = data.clinic?.address?.trim() || (showBranch ? data.branch?.address : null);
  const phone = data.clinic?.phone?.trim() || (showBranch ? data.branch?.phone : null);

  const money = (v: string): string => formatUZS(v, { withCurrency: false });
  // Rows that are zero carry no information on a paper slip; a "Chegirma 0"
  // line is just one more thing between the customer and the total.
  const hasDiscount = toTiyin(data.totals.discountTotal) > 0n;
  const hasDue = toTiyin(data.totals.due) > 0n;

  // Bir necha hisobga bo‘lingan bir xil usul (masalan, 3× Naqd) chekda bitta
  // qator bo‘lib chiqsin — aks holda pastki blok takrorlanadi.
  const paymentsByMethod = (() => {
    const map = new Map<string, { method: string; amountTiyin: bigint; notes: string[] }>();
    for (const payment of data.payments) {
      if (payment.status !== 'COMPLETED') continue;
      const amount = toTiyin(payment.amount);
      const prev = map.get(payment.method);
      const note = payment.note?.trim();
      if (prev) {
        prev.amountTiyin += amount;
        if (note && !prev.notes.includes(note)) prev.notes.push(note);
      } else {
        map.set(payment.method, {
          method: payment.method,
          amountTiyin: amount,
          notes: note ? [note] : [],
        });
      }
    }
    return [...map.values()];
  })();

  useEffect(() => {
    if (!showLogo) onReady?.();
  }, [showLogo, onReady]);

  return (
    <>
      {/*
        Zero page margin (A4 docs use 12mm). Size matches the roll so Windows /
        Chromium do not letterbox an A4 page and clip the slip. Height is a
        long sheet — continuous roll drivers ignore unused length.
        Content width is the printable head width (72mm / 48mm), not the roll.
      */}
      <style>{`
        @media print {
          @page {
            size: ${paper}mm 297mm;
            margin: 0;
          }
        }
      `}</style>

      <div
        className={cn(
          'print-area print-flow receipt-print mx-auto w-full bg-white px-2 py-3 font-mono leading-snug text-black',
          // The card framing is a screen affordance so the preview reads as a
          // slip; print keeps a small inset so glyphs stay off the head edges.
          'rounded-md border print:rounded-none print:border-0',
          fontClass,
        )}
        data-paper-width={paper}
        style={{ maxWidth: contentWidth, boxSizing: 'border-box' }}
      >
        <div className="space-y-1 text-center">
          {showLogo && data.clinic?.logoUrl ? (
            <ThermalLogo
              src={data.clinic.logoUrl}
              alt={clinicName}
              onReady={onReady}
              dotWidth={paper === '58' ? 384 : 576}
              className="mx-auto mb-2 h-auto max-h-[23mm] w-[84%] object-contain"
            />
          ) : null}
          <p className="receipt-strong font-sans text-[1.1em] font-bold uppercase leading-tight">
            {clinicName}
          </p>
          {headerText ? <p className="whitespace-pre-line">{headerText}</p> : null}
          {branchName ? <p className="text-[0.9em] leading-tight">{branchName}</p> : null}
          {address ? <p className="text-[0.9em] leading-tight">{address}</p> : null}
          {phone ? <p className="font-semibold">{formatClinicPhone(phone)}</p> : null}
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
        <p className="text-center text-[0.85em] uppercase leading-tight">{t('receipt.receiptNo')}</p>
        {/* Never broken: half an invoice number on each of two lines is not an
            invoice number. */}
        <p className="receipt-strong whitespace-nowrap text-center font-bold">
          {data.invoice.number}
        </p>
        <p className="mt-0.5 text-center text-[0.9em]">{formatTz(data.printedAt)}</p>
        <p className="mt-1 leading-tight">
          {t('receipt.patient')}: {data.patient.fullName}
          {showPatientMrn ? <span className="whitespace-nowrap"> · {data.patient.mrn}</span> : null}
        </p>
        {showCashier && user ? (
          <p className="leading-tight">
            {t('receipt.cashier')}: {user.fullName}
          </p>
        ) : null}

        <Rule />

        {data.checkout ? (
          <div className="mb-2 break-words text-[0.85em]">
            {data.checkout.invoices.map((invoice, index) => (
              <Fragment key={invoice.id}>
                {index > 0 ? ' · ' : null}
                <span className="inline-block whitespace-nowrap">{invoice.number}</span>
              </Fragment>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
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

        {paymentsByMethod.length > 0 ? (
          <>
            <Rule />
            <div>
              {/* Usul bo‘yicha jami: naqd/karta ajratiladi, lekin bir xil usul
                  bir necha payment qatoriga bo‘linsa ham chekda bitta chiqadi. */}
              {paymentsByMethod.map((row) => (
                <div key={row.method} className="break-inside-avoid">
                  <Row
                    label={t(`methods.${row.method}`)}
                    value={money(fromTiyin(row.amountTiyin))}
                  />
                  {row.notes.map((note) => (
                    <p
                      key={note}
                      className="mb-1 whitespace-pre-wrap break-words text-[0.9em]"
                    >
                      {t('pay.note')}: {note}
                    </p>
                  ))}
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
