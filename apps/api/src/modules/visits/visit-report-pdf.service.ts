import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInTimeZone } from 'date-fns-tz';
import {
  TIMEZONE,
  formatPrescriptionGroup,
  groupPrescriptionItems,
  type PrescriptionFormatItem,
} from '@avishifo/shared';
import {
  CLINIC_PDF_COLORS,
  drawClinicLetterhead,
  drawClinicPageFurniture,
  formalClinicName,
  preparePdfClinicLogo,
  type PdfClinicProfile,
} from '../../common/pdf/clinic-letterhead';
import {
  drawClinicalRichText,
  hasClinicalText,
} from './clinical-rich-pdf';

export interface VisitReportPdfData {
  id: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  title: string | null;
  body: string | null;
  clinic: PdfClinicProfile;
  patient: { fullName: string; mrn: string; dob: string | null };
  doctorName: string;
  doctorSpecialty: string | null;
  doctorPhone: string | null;
  confirmedAt: string;
  latestAmendment?: { at: string; authorName: string; reason: string | null } | null;
  subjective: string | null;
  objective: string | null;
  assessmentNote: string | null;
  plan: string | null;
  diagnosisPrimary?: string | null;
  diagnosisSecondary?: string | null;
  emptyConfirmReason?: string | null;
  documents?: Array<{ id: string; title: string; fileName: string }>;
  physiotherapy?: string | null;
  diagnoses: Array<{ code: string; name: string; note: string | null; primary: boolean }>;
  prescriptions: PrescriptionFormatItem[];
}

const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const MARGIN = 48;
const CONTENT_WIDTH = 595.28 - MARGIN * 2;
const PRESCRIPTION_LABELS = {
  uz: {
    title: 'Tayinlangan dori vositalari',
    documentTitle: 'Retsept',
    physiotherapy: 'Fizioterapiya',
    empty: 'Retsept yozilmagan.',
    days: (count: number) => `${count} kun`,
    dripUnit: 'tomchi/daqiqa',
  },
  ru: {
    title: 'Назначенные препараты',
    documentTitle: 'Рецепт',
    physiotherapy: 'Физиотерапия',
    empty: 'Рецепт не назначен.',
    days: (count: number) => `${count} дн.`,
    dripUnit: 'капель/мин',
  },
  en: {
    title: 'Prescribed medicines',
    documentTitle: 'Prescription',
    physiotherapy: 'Physiotherapy',
    empty: 'No prescriptions recorded.',
    days: (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`,
    dripUnit: 'drops/min',
  },
};

export type VisitReportPdfMode = 'summary' | 'prescription';

function birthYearLabel(dob: string | null): string | null {
  if (!dob) return null;
  const year = formatInTimeZone(dob, TIMEZONE, 'yyyy');
  return `${year} y.t.`;
}

function formatDoctorPhone(phone: string | null): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('998')) {
    return `+998-${digits.slice(3, 5)}-${digits.slice(5, 8)}-${digits.slice(8, 10)}-${digits.slice(10)}`;
  }
  return phone.trim();
}

/** Plain clinical line for the tavsiya sheet (not formal Rp.). */
function formatTavsiyaMedicine(
  group: readonly PrescriptionFormatItem[],
  labels: (typeof PRESCRIPTION_LABELS)['uz'],
): string {
  const lines = formatPrescriptionGroup(group, labels);
  const name = lines.components.join(' + ');
  const tail = [lines.dtd.replace(/^M\.\s*/, ''), lines.signature].filter(Boolean).join(', ');
  return tail ? `${name} — ${tail}` : name;
}

/**
 * Server-rendered A4 report.
 * Consultation summary follows the clinic's simple «tavsiya» sheet
 * (FISH → TASHXIS → narrative → TAVSIYA → doctor), not a dense SOAP dump.
 */
@Injectable()
export class VisitReportPdfService {
  async render(
    data: VisitReportPdfData,
    locale: 'uz' | 'ru' | 'en' = 'uz',
    mode: VisitReportPdfMode = 'summary',
  ): Promise<Buffer> {
    const logo = await preparePdfClinicLogo(data.clinic.logoUrl);
    const prescriptionLabels = PRESCRIPTION_LABELS[locale];
    const prescriptionOnly = mode === 'prescription' && data.kind !== 'ULTRASOUND';
    const clinicName = formalClinicName(data.clinic);
    const reportTitle = prescriptionOnly
      ? prescriptionLabels.documentTitle
      : data.title ||
        (data.kind === 'ULTRASOUND'
          ? 'Ultratovush tekshiruvi xulosasi'
          : `«${clinicName}» KLINIKASIDAGI KO‘RIK`);
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 74, bottom: 62, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: reportTitle,
      },
    });
    const chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.registerFont('body', FONT).registerFont('bold', BOLD);
    drawClinicLetterhead(doc, data.clinic, logo, MARGIN);

    if (prescriptionOnly) {
      this.renderPrescriptionOnly(doc, data, prescriptionLabels, reportTitle);
    } else if (data.kind === 'ULTRASOUND') {
      this.renderUltrasound(doc, data, prescriptionLabels, reportTitle);
    } else {
      this.renderConsultationTavsiya(doc, data, prescriptionLabels, reportTitle);
    }

    drawClinicPageFurniture(doc, data.clinic, {
      margin: MARGIN,
      documentLabel: reportTitle,
    });
    doc.end();
    return result;
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed = 90): void {
    if (doc.y > doc.page.height - needed) doc.addPage();
  }

  private heading(doc: PDFKit.PDFDocument, title: string): void {
    this.ensureSpace(doc, 100);
    doc
      .moveDown(0.55)
      .font('bold')
      .fontSize(11)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(title, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.2);
  }

  private bodyText(doc: PDFKit.PDFDocument, text: string, size = 10.5): void {
    drawClinicalRichText(doc, text, {
      width: CONTENT_WIDTH,
      x: MARGIN,
      ink: CLINIC_PDF_COLORS.ink,
      defaultSize: size,
      ensureSpace: (needed) => this.ensureSpace(doc, needed),
    });
  }

  private labeledBlock(doc: PDFKit.PDFDocument, label: string, body: string | null): void {
    if (!hasClinicalText(body)) return;
    this.ensureSpace(doc, 100);
    doc.moveDown(0.45);
    doc.font('bold').fontSize(10).fillColor(CLINIC_PDF_COLORS.ink).text(label, {
      width: CONTENT_WIDTH,
      continued: false,
    });
    this.bodyText(doc, body!);
  }

  private renderConsultationTavsiya(
    doc: PDFKit.PDFDocument,
    data: VisitReportPdfData,
    prescriptionLabels: (typeof PRESCRIPTION_LABELS)['uz'],
    reportTitle: string,
  ): void {
    const dateLine = formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy');
    doc
      .font('body')
      .fontSize(10)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(`${dateLine} y.`, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.55);
    doc
      .font('bold')
      .fontSize(12)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(reportTitle, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.7);

    const birth = birthYearLabel(data.patient.dob);
    doc
      .font('bold')
      .fontSize(10.5)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(`FISH:   ${data.patient.fullName}${birth ? `, ${birth}` : ''}`, {
        width: CONTENT_WIDTH,
      });
    doc
      .font('body')
      .fontSize(8.5)
      .fillColor(CLINIC_PDF_COLORS.muted)
      .text(`Karta: ${data.patient.mrn}`, { width: CONTENT_WIDTH });
    doc.moveDown(0.45);

    const freePrimary = data.diagnosisPrimary?.trim();
    const freeSecondary = data.diagnosisSecondary?.trim();
    const legacyPrimary = data.diagnoses.filter((item) => item.primary);
    const legacySecondary = data.diagnoses.filter((item) => !item.primary);
    if (freePrimary || freeSecondary || legacyPrimary.length || legacySecondary.length) {
      this.heading(doc, 'TASHXISI:');
      if (freePrimary) {
        doc
          .font('bold')
          .fontSize(10)
          .fillColor(CLINIC_PDF_COLORS.ink)
          .text(`ASOSIY:  ${freePrimary}`, { width: CONTENT_WIDTH });
      } else if (legacyPrimary.length) {
        doc
          .font('bold')
          .fontSize(10)
          .fillColor(CLINIC_PDF_COLORS.ink)
          .text(
            `ASOSIY:  ${legacyPrimary
              .map((item) => (item.note?.trim() ? `${item.name}. ${item.note.trim()}` : item.name))
              .join('\n')}`,
            { width: CONTENT_WIDTH },
          );
      }
      if (freeSecondary) {
        doc
          .font('bold')
          .fontSize(10)
          .fillColor(CLINIC_PDF_COLORS.ink)
          .text(`YONDOSH:  ${freeSecondary}`, { width: CONTENT_WIDTH });
      } else if (legacySecondary.length) {
        doc
          .font('bold')
          .fontSize(10)
          .fillColor(CLINIC_PDF_COLORS.ink)
          .text(
            `YONDOSH:  ${legacySecondary
              .map((item) => (item.note?.trim() ? `${item.name}. ${item.note.trim()}` : item.name))
              .join('\n')}`,
            { width: CONTENT_WIDTH },
          );
      }
    }

    this.labeledBlock(doc, 'Shikoyatlari / anamnezi:', data.subjective);
    this.labeledBlock(doc, 'Obyektiv holat:', data.objective);
    this.labeledBlock(doc, 'Laborator-instrumental / xulosa:', data.assessmentNote);
    if (hasClinicalText(data.body)) {
      this.ensureSpace(doc, 100);
      doc.moveDown(0.45);
      this.bodyText(doc, data.body!);
    }

    const groups = groupPrescriptionItems(data.prescriptions);
    const hasTavsiya =
      hasClinicalText(data.plan) || groups.length > 0 || Boolean(data.physiotherapy?.trim());
    if (hasTavsiya) {
      this.heading(doc, 'TAVSIYA:');
      if (hasClinicalText(data.plan)) this.bodyText(doc, data.plan!);
      for (const group of groups) {
        const line = formatTavsiyaMedicine(group, prescriptionLabels);
        if (!line) continue;
        this.ensureSpace(doc, 70);
        doc
          .font('body')
          .fontSize(10)
          .fillColor(CLINIC_PDF_COLORS.ink)
          .text(line, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2 });
      }
      if (data.physiotherapy?.trim()) {
        this.labeledBlock(doc, `${prescriptionLabels.physiotherapy}:`, data.physiotherapy);
      }
    }

    if (data.emptyConfirmReason?.trim()) {
      this.labeledBlock(
        doc,
        'Bo‘sh xulosa sababi:',
        data.emptyConfirmReason,
      );
    }
    if (data.documents?.length) {
      this.labeledBlock(
        doc,
        'Biriktirilgan hujjatlar:',
        data.documents.map((docItem) => `• ${docItem.title || docItem.fileName}`).join('\n'),
      );
    }

    this.renderSignature(doc, data);
    this.renderAmendment(doc, data);
  }

  private renderUltrasound(
    doc: PDFKit.PDFDocument,
    data: VisitReportPdfData,
    prescriptionLabels: (typeof PRESCRIPTION_LABELS)['uz'],
    reportTitle: string,
  ): void {
    doc
      .font('bold')
      .fontSize(14)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(reportTitle, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.55);
    const birth = birthYearLabel(data.patient.dob);
    doc
      .font('bold')
      .fontSize(11)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(`${data.patient.fullName}${birth ? `  ·  ${birth}` : ''}`, {
        width: CONTENT_WIDTH,
        align: 'center',
      });
    doc
      .font('body')
      .fontSize(9)
      .fillColor(CLINIC_PDF_COLORS.muted)
      .text(
        [
          `Karta: ${data.patient.mrn}`,
          `Shifokor: ${data.doctorName}`,
          `Tasdiqlangan: ${formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy HH:mm')}`,
        ].join('  ·  '),
        { width: CONTENT_WIDTH, align: 'center' },
      );
    doc.moveDown(0.35);
    const ruleY = doc.y;
    doc
      .moveTo(MARGIN, ruleY)
      .lineTo(MARGIN + CONTENT_WIDTH, ruleY)
      .strokeColor(CLINIC_PDF_COLORS.rule)
      .lineWidth(0.6)
      .stroke();
    doc.y = ruleY + 10;
    // UZI: main narrative first, exactly as typed in the editor (order + formatting).
    if (hasClinicalText(data.body)) {
      this.bodyText(doc, data.body!, 11);
      doc.moveDown(0.35);
    }
    this.labeledBlock(doc, 'Shikoyatlar / anamnez:', data.subjective);
    this.labeledBlock(doc, 'Ko‘rik va tekshiruv:', data.objective);
    this.labeledBlock(doc, 'Baholash:', data.assessmentNote);
    if (data.diagnoses.length) {
      this.labeledBlock(
        doc,
        'Tashxis:',
        data.diagnoses
          .map(
            (item) =>
              `${item.primary ? 'Asosiy: ' : ''}${item.code} — ${item.name}${item.note ? `\n${item.note}` : ''}`,
          )
          .join('\n'),
      );
    }
    this.labeledBlock(doc, 'Tavsiyalar:', data.plan);
    this.labeledBlock(doc, prescriptionLabels.physiotherapy, data.physiotherapy ?? null);
    this.renderSignature(doc, data);
    this.renderAmendment(doc, data);
  }

  private renderPrescriptionOnly(
    doc: PDFKit.PDFDocument,
    data: VisitReportPdfData,
    prescriptionLabels: (typeof PRESCRIPTION_LABELS)['uz'],
    reportTitle: string,
  ): void {
    doc
      .font('bold')
      .fontSize(13)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(reportTitle, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.5);
    const birth = birthYearLabel(data.patient.dob);
    doc
      .font('bold')
      .fontSize(10.5)
      .text(`FISH:   ${data.patient.fullName}${birth ? `, ${birth}` : ''}`, {
        width: CONTENT_WIDTH,
      });
    doc
      .font('body')
      .fontSize(8.5)
      .fillColor(CLINIC_PDF_COLORS.muted)
      .text(
        `Karta: ${data.patient.mrn} · Shifokor: ${data.doctorName} · ${formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy HH:mm')}`,
        { width: CONTENT_WIDTH },
      );
    doc.moveDown(0.5);

    const groups = groupPrescriptionItems(data.prescriptions);
    if (groups.length === 0) {
      doc
        .font('body')
        .fontSize(10)
        .fillColor(CLINIC_PDF_COLORS.muted)
        .text(prescriptionLabels.empty, MARGIN, doc.y, { width: CONTENT_WIDTH });
    }
    for (const [index, group] of groups.entries()) {
      const lines = formatPrescriptionGroup(group, prescriptionLabels);
      const rows = [
        ...lines.components.map((component, componentIndex) => ({
          text: `${componentIndex === 0 ? 'Rp.: ' : ''}${component}`,
          indent: componentIndex === 0 ? 0 : 22,
          bold: componentIndex === 0,
        })),
        ...(lines.dtd ? [{ text: lines.dtd, indent: 22, bold: false }] : []),
        ...(lines.signature ? [{ text: `S.: ${lines.signature}`, indent: 22, bold: false }] : []),
      ];
      const groupHeight = rows.reduce(
        (height, row) =>
          height +
          doc
            .font(row.bold ? 'bold' : 'body')
            .fontSize(10)
            .heightOfString(row.text, { width: CONTENT_WIDTH - row.indent, lineGap: 3 }),
        0,
      );
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      const required = Math.min(groupHeight + 12, pageBottom - doc.page.margins.top);
      if (doc.y + required > pageBottom) doc.addPage();
      if (index > 0) doc.moveDown(0.35);
      for (const row of rows) {
        doc
          .font(row.bold ? 'bold' : 'body')
          .fontSize(10)
          .fillColor(CLINIC_PDF_COLORS.ink)
          .text(row.text, MARGIN + row.indent, doc.y, {
            width: CONTENT_WIDTH - row.indent,
            lineGap: 3,
          });
      }
      doc.x = MARGIN;
    }
    this.labeledBlock(doc, prescriptionLabels.physiotherapy, data.physiotherapy ?? null);
    this.renderSignature(doc, data);
  }

  private renderSignature(doc: PDFKit.PDFDocument, data: VisitReportPdfData): void {
    this.ensureSpace(doc, 120);
    doc.moveDown(1.2);
    const role = data.doctorSpecialty?.trim() || 'Shifokor';
    doc
      .font('bold')
      .fontSize(10)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(`${role}:`, MARGIN, doc.y, { width: CONTENT_WIDTH * 0.45, continued: false });
    const roleBottom = doc.y;
    doc
      .font('bold')
      .fontSize(10)
      .text(data.doctorName, MARGIN + CONTENT_WIDTH * 0.45, roleBottom - 12, {
        width: CONTENT_WIDTH * 0.55,
        align: 'right',
      });
    doc.y = Math.max(doc.y, roleBottom);
    const phone = formatDoctorPhone(data.doctorPhone);
    if (phone) {
      doc.moveDown(0.35);
      doc
        .font('body')
        .fontSize(9)
        .fillColor(CLINIC_PDF_COLORS.muted)
        .text(`Tel: ${phone}`, { width: CONTENT_WIDTH });
    }
    doc
      .moveDown(0.35)
      .font('body')
      .fontSize(8)
      .fillColor(CLINIC_PDF_COLORS.muted)
      .text(
        `Tasdiqlangan: ${formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy HH:mm')}`,
        { width: CONTENT_WIDTH },
      );
  }

  private renderAmendment(doc: PDFKit.PDFDocument, data: VisitReportPdfData): void {
    if (!data.latestAmendment) return;
    this.labeledBlock(
      doc,
      'Oxirgi tuzatish:',
      [
        `${formatInTimeZone(data.latestAmendment.at, TIMEZONE, 'dd.MM.yyyy HH:mm')} · ${data.latestAmendment.authorName}`,
        data.latestAmendment.reason ? `Sabab: ${data.latestAmendment.reason}` : null,
        'Ushbu nusxa oxirgi tuzatishlarni o‘z ichiga oladi.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}
