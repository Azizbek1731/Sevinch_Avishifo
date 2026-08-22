import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInTimeZone } from 'date-fns-tz';
import { ResultFlag, TIMEZONE, formatRangeBounds, type ReferenceRangeInput } from '@avishifo/shared';

/**
 * The lab result as a PDF — the artefact a patient keeps.
 *
 * Rendered server-side so the same file reaches every channel identically: the
 * clinic app's download button, the patient portal, and the Telegram bot. The
 * browser's print dialog cannot be the answer here because two of those three
 * channels have no browser.
 *
 * DejaVu Sans is embedded because the built-in PDF fonts cannot spell the
 * content: Helvetica has no Cyrillic for the Russian names and no ʻ for Uzbek.
 */

/** Shape of lab.service printPayload, narrowed to what the PDF draws. */
export interface ResultPdfData {
  clinic: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
  };
  order: {
    orderNumber: string;
    createdAt: string | null;
    collectedAt: string | null;
    physiologicalState: string | null;
    patient: {
      mrn: string;
      fullName: string;
      dob: string | null;
      gender: string | null;
    };
    items: Array<{
      labTest: {
        code: string;
        name: Record<string, string>;
        parameters: Array<{
          id: string;
          name: string;
          unit: string | null;
          matchedRange?: ReferenceRangeInput | null;
          referenceRanges: ReferenceRangeInput[];
        }>;
      };
      result: {
        note: string | null;
        values: Array<{ parameterId: string; value: string; flag: ResultFlag }>;
      } | null;
    }>;
  };
  approvedBy: { fullName: string } | null;
}

const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

/** Everything the layout needs to speak the reader's language. */
interface PdfLabels {
  title: string;
  patient: string;
  card: string;
  dob: string;
  gender: string;
  male: string;
  female: string;
  date: string;
  parameter: string;
  value: string;
  unit: string;
  reference: string;
  flag: string;
  note: string;
  approved: string;
  notApproved: string;
  critical: string;
  page: string;
}

const LABELS: Record<'uz' | 'ru' | 'en', PdfLabels> = {
  uz: {
    title: 'Laboratoriya tekshiruvi natijasi',
    patient: 'Bemor',
    card: 'Karta',
    dob: "Tug'ilgan sana",
    gender: 'Jinsi',
    male: 'Erkak',
    female: 'Ayol',
    date: 'Sana',
    parameter: "Ko'rsatkich",
    value: 'Natija',
    unit: 'Birlik',
    reference: 'Norma',
    flag: 'Belgi',
    note: 'Izoh',
    approved: 'Tasdiqladi',
    notApproved: 'Natija hali tasdiqlanmagan',
    critical: 'DIQQAT: xavfli (kritik) qiymat — shifokorga murojaat qiling',
    page: 'Sahifa',
  },
  ru: {
    title: 'Результат лабораторного исследования',
    patient: 'Пациент',
    card: 'Карта',
    dob: 'Дата рождения',
    gender: 'Пол',
    male: 'Мужской',
    female: 'Женский',
    date: 'Дата',
    parameter: 'Показатель',
    value: 'Результат',
    unit: 'Ед.',
    reference: 'Норма',
    flag: 'Отм.',
    note: 'Примечание',
    approved: 'Утвердил(а)',
    notApproved: 'Результат ещё не утверждён',
    critical: 'ВНИМАНИЕ: критическое значение — обратитесь к врачу',
    page: 'Стр.',
  },
  en: {
    title: 'Laboratory test result',
    patient: 'Patient',
    card: 'Card',
    dob: 'Date of birth',
    gender: 'Sex',
    male: 'Male',
    female: 'Female',
    date: 'Date',
    parameter: 'Parameter',
    value: 'Result',
    unit: 'Unit',
    reference: 'Reference',
    flag: 'Flag',
    note: 'Note',
    approved: 'Approved by',
    notApproved: 'Not yet approved',
    critical: 'ATTENTION: critical value — contact your clinician',
    page: 'Page',
  },
};

export type PdfLocale = keyof typeof LABELS;

const FLAG_MARK: Record<ResultFlag, string> = {
  [ResultFlag.NORMAL]: '',
  [ResultFlag.HIGH]: 'H',
  [ResultFlag.LOW]: 'L',
  [ResultFlag.ABNORMAL]: 'A',
  [ResultFlag.CRITICAL_HIGH]: 'H!!',
  [ResultFlag.CRITICAL_LOW]: 'L!!',
};

const INK = '#1a1a1a';
const MUTED = '#666666';
const RULE = '#c9c9c9';
const ZEBRA = '#f5f7fa';
const BRAND = '#1d64c4';
const RED = '#c0262b';
const BLUE = '#1d5fbf';

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 44;
const CONTENT_W = A4.width - MARGIN * 2;

/** Column layout of the results table, in fractions of the content width. */
const COLS = [0.34, 0.16, 0.1, 0.32, 0.08] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  // Clinic wall-clock, not UTC: a specimen taken at 03:07 Tashkent time was
  // taken on the 23rd, and the paper must not say the 22nd.
  return formatInTimeZone(new Date(iso), TIMEZONE, 'dd.MM.yyyy');
}

function localName(name: Record<string, string>, locale: PdfLocale): string {
  return name[locale] ?? name.uz ?? Object.values(name)[0] ?? '—';
}

@Injectable()
export class ResultPdfService {
  /** Renders the whole document and resolves with its bytes. */
  render(data: ResultPdfData, locale: PdfLocale = 'uz'): Promise<Buffer> {
    const L = LABELS[locale] ?? LABELS.uz;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN },
      info: { Title: `${L.title} — ${data.order.orderNumber}` },
      // Pages stay in memory until the end so the footer pass can revisit them.
      bufferPages: true,
    });
    doc.registerFont('body', FONT);
    doc.registerFont('bold', FONT_BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.header(doc, data, L);
    this.patientBlock(doc, data, L);

    let critical = false;
    for (const item of data.order.items) {
      critical = this.testBlock(doc, item, L, locale) || critical;
    }
    if (critical) this.criticalBanner(doc, L);
    this.signature(doc, data, L);
    this.pageFooters(doc, data, L);

    doc.end();
    return done;
  }

  // ------------------------------------------------------------ sections

  private header(doc: PDFKit.PDFDocument, data: ResultPdfData, L: PdfLabels): void {
    const { clinic, order } = data;
    doc.font('bold').fontSize(16).fillColor(BRAND).text(clinic.name, MARGIN, MARGIN);
    doc.font('body').fontSize(8.5).fillColor(MUTED);
    const contact = [clinic.address, clinic.phone].filter(Boolean).join('  ·  ');
    if (contact) doc.text(contact);

    // Right side of the same band: what this paper is, and its number.
    doc.font('bold').fontSize(11).fillColor(INK);
    doc.text(L.title, MARGIN, MARGIN, { width: CONTENT_W, align: 'right' });
    doc.font('body').fontSize(9).fillColor(MUTED);
    doc.text(`№ ${order.orderNumber}`, MARGIN, MARGIN + 16, { width: CONTENT_W, align: 'right' });
    doc.text(`${L.date}: ${fmtDate(order.collectedAt ?? order.createdAt)}`, MARGIN, MARGIN + 29, {
      width: CONTENT_W,
      align: 'right',
    });

    const y = Math.max(doc.y, MARGIN + 44);
    doc
      .moveTo(MARGIN, y)
      .lineTo(A4.width - MARGIN, y)
      .lineWidth(1.2)
      .strokeColor(BRAND)
      .stroke();
    doc.y = y + 12;
  }

  private patientBlock(doc: PDFKit.PDFDocument, data: ResultPdfData, L: PdfLabels): void {
    const p = data.order.patient;
    const y = doc.y;
    const cell = (label: string, value: string, x: number, w: number): void => {
      doc.font('body').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x, y, { width: w });
      doc.font('bold').fontSize(10).fillColor(INK).text(value, x, y + 10, { width: w });
    };
    const gender =
      p.gender === 'MALE' ? L.male : p.gender === 'FEMALE' ? L.female : '—';
    cell(L.patient, p.fullName, MARGIN, CONTENT_W * 0.42);
    cell(L.card, p.mrn, MARGIN + CONTENT_W * 0.44, CONTENT_W * 0.16);
    cell(L.dob, fmtDate(p.dob), MARGIN + CONTENT_W * 0.62, CONTENT_W * 0.2);
    cell(L.gender, gender, MARGIN + CONTENT_W * 0.84, CONTENT_W * 0.16);
    doc.y = y + 30;
  }

  /** One ordered test with its results table. Returns true if a critical flag was drawn. */
  private testBlock(
    doc: PDFKit.PDFDocument,
    item: ResultPdfData['order']['items'][number],
    L: PdfLabels,
    locale: PdfLocale,
  ): boolean {
    let critical = false;
    const valueById = new Map(
      (item.result?.values ?? []).map((v) => [v.parameterId, v] as const),
    );

    this.ensureRoom(doc, 64);
    doc.moveDown(0.7);
    doc.font('bold').fontSize(11.5).fillColor(INK).text(localName(item.labTest.name, locale), MARGIN, doc.y);
    doc.moveDown(0.35);

    // Table head
    const headY = doc.y;
    const xs = this.colX();
    doc
      .rect(MARGIN, headY - 2, CONTENT_W, 15)
      .fillColor('#eef2f7')
      .fill();
    doc.font('bold').fontSize(8).fillColor(MUTED);
    const heads = [L.parameter, L.value, L.unit, L.reference, L.flag];
    heads.forEach((h, i) =>
      doc.text(h.toUpperCase(), xs[i]! + 3, headY + 1, { width: this.colW(i) - 6 }),
    );
    doc.y = headY + 16;

    let zebra = false;
    for (const param of item.labTest.parameters) {
      const v = valueById.get(param.id);
      if (!v) continue; // only what was actually measured goes on the paper
      const mark = FLAG_MARK[v.flag] ?? '';
      const isCritical = v.flag === ResultFlag.CRITICAL_HIGH || v.flag === ResultFlag.CRITICAL_LOW;
      critical = critical || isCritical;
      // Only the interval that actually applies to THIS patient. Falling back to
      // the first stored row printed a newborn band next to an adult's result
      // whenever the patient's age was unknown — a wrong norm is worse than none.
      const range = param.matchedRange ?? null;
      const refText = range ? formatRangeBounds(range) : '—';

      const cells = [param.name, v.value, param.unit ?? '', refText, mark];
      const rowH =
        Math.max(
          ...cells.map((c, i) =>
            doc.font('body').fontSize(9).heightOfString(String(c), { width: this.colW(i) - 6 }),
          ),
        ) + 7;
      this.ensureRoom(doc, rowH);
      const y = doc.y;
      if (zebra) {
        doc.rect(MARGIN, y - 2, CONTENT_W, rowH).fillColor(ZEBRA).fill();
      }
      zebra = !zebra;

      const valueColor = isCritical
        ? RED
        : v.flag === ResultFlag.HIGH || v.flag === ResultFlag.ABNORMAL
          ? RED
          : v.flag === ResultFlag.LOW
            ? BLUE
            : INK;
      doc.font('body').fontSize(9).fillColor(INK).text(param.name, xs[0]! + 3, y, { width: this.colW(0) - 6 });
      doc
        .font(v.flag === ResultFlag.NORMAL ? 'body' : 'bold')
        .fillColor(valueColor)
        .text(v.value, xs[1]! + 3, y, { width: this.colW(1) - 6 });
      doc.font('body').fillColor(MUTED).text(param.unit ?? '', xs[2]! + 3, y, { width: this.colW(2) - 6 });
      doc.fillColor(MUTED).text(refText, xs[3]! + 3, y, { width: this.colW(3) - 6 });
      doc.font('bold').fillColor(valueColor).text(mark, xs[4]! + 3, y, { width: this.colW(4) - 6 });
      doc.y = y + rowH;
    }
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(A4.width - MARGIN, doc.y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.y += 4;

    if (item.result?.note) {
      this.ensureRoom(doc, 24);
      doc.font('body').fontSize(8.5).fillColor(MUTED);
      doc.text(`${L.note}: ${item.result.note}`, MARGIN, doc.y, { width: CONTENT_W });
      doc.y += 4;
    }
    return critical;
  }

  private criticalBanner(doc: PDFKit.PDFDocument, L: PdfLabels): void {
    this.ensureRoom(doc, 34);
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 24).fillColor('#fdecec').fill();
    doc
      .rect(MARGIN, y, 3, 24)
      .fillColor(RED)
      .fill();
    doc.font('bold').fontSize(9).fillColor(RED).text(L.critical, MARGIN + 12, y + 7, {
      width: CONTENT_W - 20,
    });
    doc.y = y + 32;
  }

  private signature(doc: PDFKit.PDFDocument, data: ResultPdfData, L: PdfLabels): void {
    this.ensureRoom(doc, 40);
    doc.moveDown(1.2);
    const y = doc.y;
    doc.font('body').fontSize(9).fillColor(INK);
    if (data.approvedBy) {
      doc.text(`${L.approved}: ${data.approvedBy.fullName}`, MARGIN, y);
      doc
        .moveTo(A4.width - MARGIN - 150, y + 10)
        .lineTo(A4.width - MARGIN, y + 10)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke();
    } else {
      doc.fillColor(MUTED).text(L.notApproved, MARGIN, y);
    }
  }

  /** Footer on every page: brand line left, page number right. */
  private pageFooters(doc: PDFKit.PDFDocument, data: ResultPdfData, L: PdfLabels): void {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer lives inside the bottom margin; writing there normally makes
      // pdfkit start a fresh page, so the margin is zeroed for this pass.
      doc.page.margins.bottom = 0;
      const y = A4.height - 30;
      doc.font('body').fontSize(7.5).fillColor(MUTED);
      doc.text(`${data.clinic.name} · AviShifo`, MARGIN, y, {
        width: CONTENT_W / 2,
        lineBreak: false,
      });
      doc.text(`${L.page} ${i - range.start + 1}/${range.count}`, MARGIN + CONTENT_W / 2, y, {
        width: CONTENT_W / 2,
        align: 'right',
        lineBreak: false,
      });
    }
  }

  // ------------------------------------------------------------ helpers

  private colX(): number[] {
    const xs: number[] = [];
    let x = MARGIN;
    for (const f of COLS) {
      xs.push(x);
      x += CONTENT_W * f;
    }
    return xs;
  }

  private colW(i: number): number {
    return CONTENT_W * (COLS[i] ?? 0.1);
  }

  /** Starts a new page when fewer than `needed` points remain above the footer. */
  private ensureRoom(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed > A4.height - MARGIN - 20) {
      doc.addPage();
      doc.y = MARGIN;
    }
  }
}
