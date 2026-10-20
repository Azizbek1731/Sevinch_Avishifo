import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInTimeZone } from 'date-fns-tz';
import {
  ResultFlag,
  TIMEZONE,
  formatRangeBounds,
  type ReferenceRangeInput,
} from '@avishifo/shared';
import {
  CLINIC_PDF_COLORS,
  drawClinicLetterhead,
  drawClinicPageFurniture,
  preparePdfClinicLogo,
  type PdfClinicProfile,
} from '../../common/pdf/clinic-letterhead';

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
  clinic: PdfClinicProfile;
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
          labels?: { uz?: string | null; ru?: string | null; en?: string | null } | null;
          unit: string | null;
          matchedRange?: ReferenceRangeInput | null;
          referenceRanges: ReferenceRangeInput[];
        }>;
      };
      result: {
        approvedAt?: string | null;
        reportDocument?: { id: string; title: string; fileName: string } | null;
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
  fileResult: string;
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
    fileResult: 'Natija alohida faylda',
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
    fileResult: 'Результат в отдельном файле',
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
    fileResult: 'Result in a separate file',
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

const {
  ink: INK,
  muted: MUTED,
  rule: RULE,
  pale: ZEBRA,
  blue: BRAND,
  red: RED,
} = CLINIC_PDF_COLORS;
const BLUE = BRAND;

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

const PLAIN_PARAMETER_NAMES: Record<string, { ru: string; en: string }> = {
  Natija: { ru: 'Результат', en: 'Result' },
};

function parameterLabel(
  param: {
    name: string;
    labels?: { uz?: string | null; ru?: string | null; en?: string | null } | null;
  },
  locale: PdfLocale,
): string {
  const known = PLAIN_PARAMETER_NAMES[param.name];
  const labels = param.labels ?? (known ? { uz: param.name, ...known } : null);
  if (locale === 'ru') return labels?.ru || param.name;
  if (locale === 'en') return labels?.en || labels?.uz || param.name;
  return labels?.uz || param.name;
}

@Injectable()
export class ResultPdfService {
  /** Renders the whole document and resolves with its bytes. */
  async render(data: ResultPdfData, locale: PdfLocale = 'uz'): Promise<Buffer> {
    const logo = await preparePdfClinicLogo(data.clinic.logoUrl);
    const L = LABELS[locale] ?? LABELS.uz;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 74, bottom: 62, left: MARGIN, right: MARGIN },
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

    drawClinicLetterhead(doc, data.clinic, logo, MARGIN);
    this.header(doc, data, L);
    this.patientBlock(doc, data, L);

    let critical = false;
    for (const item of data.order.items) {
      critical = this.testBlock(doc, item, L, locale) || critical;
    }
    if (critical) this.criticalBanner(doc, L);
    this.signature(doc, data, L);
    drawClinicPageFurniture(doc, data.clinic, {
      margin: MARGIN,
      documentLabel: L.title,
      documentId: `№ ${data.order.orderNumber}`,
      pageLabel: L.page,
    });

    doc.end();
    return done;
  }

  // ------------------------------------------------------------ sections

  private header(doc: PDFKit.PDFDocument, data: ResultPdfData, L: PdfLabels): void {
    const { order } = data;
    doc.font('bold').fontSize(13).fillColor(INK).text(L.title, MARGIN, doc.y, { width: CONTENT_W });
    const y = doc.y + 6;
    doc
      .font('body')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`№ ${order.orderNumber}`, MARGIN, y, { width: CONTENT_W / 2 });
    doc.text(
      `${L.date}: ${fmtDate(order.collectedAt ?? order.createdAt)}`,
      MARGIN + CONTENT_W / 2,
      y,
      { width: CONTENT_W / 2, align: 'right' },
    );
    doc.y += 13;
  }

  private patientBlock(doc: PDFKit.PDFDocument, data: ResultPdfData, L: PdfLabels): void {
    const p = data.order.patient;
    const y = doc.y;
    doc.font('bold').fontSize(10.5);
    const nameHeight = doc.heightOfString(p.fullName, { width: CONTENT_W - 24 });
    const height = Math.max(68, nameHeight + 53);
    doc.roundedRect(MARGIN, y, CONTENT_W, height, 5).fillColor(ZEBRA).fill();
    doc
      .font('body')
      .fontSize(7)
      .fillColor(MUTED)
      .text(L.patient.toUpperCase(), MARGIN + 12, y + 9, { width: CONTENT_W - 24 });
    doc
      .font('bold')
      .fontSize(10.5)
      .fillColor(INK)
      .text(p.fullName, MARGIN + 12, y + 19, { width: CONTENT_W - 24 });
    const detailY = y + nameHeight + 27;
    const cell = (label: string, value: string, x: number, w: number): void => {
      doc.font('body').fontSize(7).fillColor(MUTED).text(label, x, detailY, { width: w });
      doc
        .font('bold')
        .fontSize(8.5)
        .fillColor(INK)
        .text(value, x, detailY + 10, { width: w });
    };
    const gender = p.gender === 'MALE' ? L.male : p.gender === 'FEMALE' ? L.female : '—';
    cell(L.card, p.mrn, MARGIN + 12, CONTENT_W * 0.34);
    cell(L.dob, fmtDate(p.dob), MARGIN + CONTENT_W * 0.4, CONTENT_W * 0.32);
    cell(L.gender, gender, MARGIN + CONTENT_W * 0.77, CONTENT_W * 0.2);
    doc.y = y + height + 7;
  }

  /** One ordered test with its results table. Returns true if a critical flag was drawn. */
  private testBlock(
    doc: PDFKit.PDFDocument,
    item: ResultPdfData['order']['items'][number],
    L: PdfLabels,
    locale: PdfLocale,
  ): boolean {
    let critical = false;
    const valueById = new Map((item.result?.values ?? []).map((v) => [v.parameterId, v] as const));

    this.ensureRoom(doc, 64);
    doc.moveDown(0.7);
    doc
      .font('bold')
      .fontSize(11.5)
      .fillColor(INK)
      .text(localName(item.labTest.name, locale), MARGIN, doc.y);
    doc.moveDown(0.35);

    if (item.result?.reportDocument) {
      doc
        .font('body')
        .fontSize(10)
        .fillColor(INK)
        .text(`${L.fileResult}: ${item.result.reportDocument.fileName}`, MARGIN, doc.y, {
          width: CONTENT_W,
        });
      if (item.result.note)
        doc
          .fontSize(9)
          .fillColor(MUTED)
          .text(`${L.note}: ${item.result.note}`, { width: CONTENT_W });
      doc.moveDown(0.5);
      return false;
    }

    this.tableHeader(doc, L);

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

      const valueColor = isCritical
        ? RED
        : v.flag === ResultFlag.HIGH || v.flag === ResultFlag.ABNORMAL
          ? RED
          : v.flag === ResultFlag.LOW
            ? BLUE
            : INK;
      this.tableRow(
        doc,
        [parameterLabel(param, locale), v.value, param.unit ?? '', refText, mark],
        {
          valueColor,
          emphasis: v.flag !== ResultFlag.NORMAL,
          zebra,
          labels: L,
        },
      );
      zebra = !zebra;
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
    doc.rect(MARGIN, y, 3, 24).fillColor(RED).fill();
    doc
      .font('bold')
      .fontSize(9)
      .fillColor(RED)
      .text(L.critical, MARGIN + 12, y + 7, {
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
      const signedAt = data.order.items.find((item) => item.result?.approvedAt)?.result?.approvedAt;
      if (signedAt)
        doc
          .fontSize(8)
          .fillColor(MUTED)
          .text(formatInTimeZone(new Date(signedAt), TIMEZONE, 'dd.MM.yyyy HH:mm'), MARGIN, y + 14);
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

  // ------------------------------------------------------------ helpers

  private tableHeader(doc: PDFKit.PDFDocument, labels: PdfLabels): void {
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 23).fillColor(ZEBRA).fill();
    doc.font('bold').fontSize(7.5).fillColor(BRAND);
    const xs = this.colX();
    [labels.parameter, labels.value, labels.unit, labels.reference, labels.flag].forEach(
      (title, index) =>
        doc.text(title.toUpperCase(), xs[index]! + 5, y + 6, {
          width: this.colW(index) - 10,
          height: 16,
          lineBreak: false,
        }),
    );
    doc.y = y + 28;
  }

  /** Explicit wrapping lets an unusually long result continue safely as a table row. */
  private cellLines(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (doc.widthOfString(candidate) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = '';
        for (const character of word) {
          if (line && doc.widthOfString(line + character) > width) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  private tableRow(
    doc: PDFKit.PDFDocument,
    cells: string[],
    options: { valueColor: string; emphasis: boolean; zebra: boolean; labels: PdfLabels },
  ): void {
    const lineHeight = 12;
    const padding = 6;
    const bottom = A4.height - 64;
    const xs = this.colX();
    const lines = cells.map((value, index) => {
      doc.font(index === 4 || (index === 1 && options.emphasis) ? 'bold' : 'body').fontSize(9);
      return this.cellLines(doc, value, this.colW(index) - 10);
    });
    const totalLines = Math.max(...lines.map((cell) => cell.length));
    const rowHeight = totalLines * lineHeight + padding;
    // Keep ordinary rows together; oversized rows are split below and each
    // continuation page repeats the table labels.
    if (
      doc.y + Math.min(rowHeight, 80) > bottom ||
      (rowHeight < bottom - doc.page.margins.top - 28 && doc.y + rowHeight > bottom)
    ) {
      doc.addPage();
      this.tableHeader(doc, options.labels);
    }
    let offset = 0;
    while (offset < totalLines) {
      const count = Math.min(
        totalLines - offset,
        Math.floor((bottom - doc.y - padding) / lineHeight),
      );
      if (count < 1) {
        doc.addPage();
        this.tableHeader(doc, options.labels);
        continue;
      }
      const y = doc.y;
      const height = count * lineHeight + padding;
      if (options.zebra)
        doc
          .rect(MARGIN, y - 3, CONTENT_W, height)
          .fillColor(ZEBRA)
          .fill();
      lines.forEach((cell, index) => {
        doc
          .font(index === 4 || (index === 1 && options.emphasis) ? 'bold' : 'body')
          .fontSize(9)
          .fillColor(index === 1 || index === 4 ? options.valueColor : index === 0 ? INK : MUTED);
        cell.slice(offset, offset + count).forEach((line, row) => {
          doc.text(line, xs[index]! + 5, y + row * lineHeight, {
            width: this.colW(index) - 10,
            height: lineHeight,
            lineBreak: false,
          });
        });
      });
      doc.y = y + height;
      offset += count;
      if (offset < totalLines) {
        doc.addPage();
        this.tableHeader(doc, options.labels);
      }
    }
    doc.x = MARGIN;
  }

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
      doc.y = doc.page.margins.top;
    }
  }
}
