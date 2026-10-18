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
  preparePdfClinicLogo,
  type PdfClinicProfile,
} from '../../common/pdf/clinic-letterhead';

export interface VisitReportPdfData {
  id: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  title: string | null;
  body: string | null;
  clinic: PdfClinicProfile;
  patient: { fullName: string; mrn: string; dob: string | null };
  doctorName: string;
  confirmedAt: string;
  latestAmendment?: { at: string; authorName: string; reason: string | null } | null;
  subjective: string | null;
  objective: string | null;
  assessmentNote: string | null;
  plan: string | null;
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
    physiotherapy: 'Fizioterapiya',
    days: (count: number) => `${count} kun`,
    dripUnit: 'tomchi/daqiqa',
  },
  ru: {
    title: 'Назначенные препараты',
    physiotherapy: 'Физиотерапия',
    days: (count: number) => `${count} дн.`,
    dripUnit: 'капель/мин',
  },
  en: {
    title: 'Prescribed medicines',
    physiotherapy: 'Physiotherapy',
    days: (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`,
    dripUnit: 'drops/min',
  },
};

/** Server-rendered A4 report; doctor/time identify the clinical confirmation. */
@Injectable()
export class VisitReportPdfService {
  async render(data: VisitReportPdfData, locale: 'uz' | 'ru' | 'en' = 'uz'): Promise<Buffer> {
    const logo = await preparePdfClinicLogo(data.clinic.logoUrl);
    const reportTitle = data.title || (data.kind === 'ULTRASOUND'
      ? 'Ultratovush tekshiruvi xulosasi' : 'Shifokor konsultatsiyasi xulosasi');
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 74, bottom: 62, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: data.title || (data.kind === 'ULTRASOUND' ? 'UZI xulosasi' : 'Shifokor xulosasi'),
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
    doc
      .font('bold')
      .fontSize(13)
      .fillColor(CLINIC_PDF_COLORS.ink)
      .text(reportTitle, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.y += 12;
    const patientY = doc.y;
    const patientWidth = CONTENT_WIDTH - 24;
    const metadata = [
      `Karta: ${data.patient.mrn}${data.patient.dob ? ` · Tug‘ilgan sana: ${formatInTimeZone(data.patient.dob, TIMEZONE, 'dd.MM.yyyy')}` : ''}`,
      `Shifokor: ${data.doctorName}`,
      `Tasdiqlangan: ${formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy HH:mm')}`,
    ];
    doc.font('bold').fontSize(10.5);
    const patientHeight = doc.heightOfString(data.patient.fullName, { width: patientWidth });
    doc.font('body').fontSize(8.5);
    const metadataHeight = metadata.reduce((height, line) =>
      height + doc.heightOfString(line, { width: patientWidth }) + 4, 0);
    const boxHeight = patientHeight + metadataHeight + 34;
    doc.roundedRect(MARGIN, patientY, CONTENT_WIDTH, boxHeight, 5)
      .fillColor(CLINIC_PDF_COLORS.pale).fill();
    doc.font('body').fontSize(7).fillColor(CLINIC_PDF_COLORS.muted)
      .text('BEMOR', MARGIN + 12, patientY + 9, { width: patientWidth });
    doc.font('bold').fontSize(10.5).fillColor(CLINIC_PDF_COLORS.ink)
      .text(data.patient.fullName, MARGIN + 12, patientY + 20, { width: patientWidth });
    doc.y += 7;
    for (const line of metadata) {
      doc.font('body').fontSize(8.5).fillColor(CLINIC_PDF_COLORS.muted)
        .text(line, MARGIN + 12, doc.y, { width: patientWidth });
      doc.y += 4;
    }
    doc.x = MARGIN;
    doc.y = patientY + boxHeight + 8;

    const section = (title: string, body: string | null) => {
      if (!body?.trim()) return;
      if (doc.y > doc.page.height - 115) doc.addPage();
      doc
        .moveDown(0.6)
        .font('bold')
        .fontSize(11)
        .fillColor(CLINIC_PDF_COLORS.blue)
        .text(title, MARGIN, doc.y, { width: CONTENT_WIDTH });
      doc.moveDown(0.3).font('body').fontSize(10).fillColor(CLINIC_PDF_COLORS.ink).text(body.trim(), {
        width: CONTENT_WIDTH,
        lineGap: 3,
        paragraphGap: 6,
      });
    };
    section('Xulosa', data.body);
    section('Shikoyatlar va anamnez', data.subjective);
    section('Ko‘rik va tekshiruv', data.objective);
    section('Baholash', data.assessmentNote);
    section(
      'Tashxis',
      data.diagnoses
        .map(
          (item) =>
            `${item.primary ? 'Asosiy: ' : ''}${item.code} — ${item.name}${item.note ? `\n${item.note}` : ''}`,
        )
        .join('\n'),
    );
    section('Davolash va tavsiyalar', data.plan);
    const prescriptionLabels = PRESCRIPTION_LABELS[locale];
    const groups = groupPrescriptionItems(data.prescriptions);
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
      const headingHeight = index === 0 ? 32 : 0;
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      // Keep an ordinary Rp. block together. A block longer than a page stays
      // in text flow so PDFKit can wrap and paginate every component and note.
      const required = Math.min(groupHeight + headingHeight + 12, pageBottom - doc.page.margins.top);
      if (doc.y + required > pageBottom) doc.addPage();
      if (index === 0) {
        doc
          .moveDown(0.6)
          .font('bold')
          .fontSize(11)
          .fillColor(CLINIC_PDF_COLORS.blue)
          .text(prescriptionLabels.title, MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.3);
      }
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
      doc.moveDown(0.7);
    }
    section(prescriptionLabels.physiotherapy, data.physiotherapy ?? null);

    if (doc.y > doc.page.height - 130) doc.addPage();
    doc
      .moveDown(1.2)
      .font('bold')
      .fontSize(10)
      .fillColor(CLINIC_PDF_COLORS.blue)
      .text(`Tasdiqlagan shifokor: ${data.doctorName}`);
    doc
      .font('body')
      .fontSize(9)
      .fillColor(CLINIC_PDF_COLORS.muted)
      .text(formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy HH:mm'));
    doc.moveDown(0.4).fontSize(8).text('Hujjat klinika tizimida shifokor tomonidan tasdiqlangan.');
    if (data.latestAmendment) {
      section(
        'Oxirgi tuzatish',
        [
          `${formatInTimeZone(data.latestAmendment.at, TIMEZONE, 'dd.MM.yyyy HH:mm')} · ${data.latestAmendment.authorName}`,
          data.latestAmendment.reason ? `Sabab: ${data.latestAmendment.reason}` : null,
          'Ushbu nusxa oxirgi tuzatishlarni o‘z ichiga oladi.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    drawClinicPageFurniture(doc, data.clinic, {
      margin: MARGIN, documentLabel: reportTitle, documentId: `Hujjat ID: ${data.id}`,
    });
    doc.end();
    return result;
  }
}
