import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatInTimeZone } from 'date-fns-tz';
import {
  TIMEZONE,
  formatPrescriptionGroup,
  groupPrescriptionItems,
  type PrescriptionFormatItem,
} from '@avishifo/shared';

export interface VisitReportPdfData {
  id: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  title: string | null;
  body: string | null;
  clinic: { name: string; legalName: string | null; address: string | null; phone: string | null };
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
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: 54, left: MARGIN, right: MARGIN },
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
    doc
      .font('bold')
      .fontSize(17)
      .fillColor('#16334b')
      .text(data.clinic.name, { width: CONTENT_WIDTH });
    const details = [data.clinic.address, data.clinic.phone].filter(Boolean).join(' · ');
    if (details) doc.moveDown(0.3).font('body').fontSize(9).fillColor('#526272').text(details);
    doc
      .moveDown(1)
      .font('bold')
      .fontSize(15)
      .fillColor('#111827')
      .text(
        data.title ||
          (data.kind === 'ULTRASOUND'
            ? 'Ultratovush tekshiruvi xulosasi'
            : 'Shifokor konsultatsiyasi xulosasi'),
        { width: CONTENT_WIDTH },
      );
    doc.moveDown(0.7).font('body').fontSize(10);
    doc.text(`Bemor: ${data.patient.fullName}`);
    doc.text(
      `Karta: ${data.patient.mrn}${data.patient.dob ? ` · Tug‘ilgan sana: ${formatInTimeZone(data.patient.dob, TIMEZONE, 'dd.MM.yyyy')}` : ''}`,
    );
    doc.text(`Shifokor: ${data.doctorName}`);
    doc.text(`Tasdiqlangan: ${formatInTimeZone(data.confirmedAt, TIMEZONE, 'dd.MM.yyyy HH:mm')}`);
    doc.moveDown(0.6);

    const section = (title: string, body: string | null) => {
      if (!body?.trim()) return;
      if (doc.y > doc.page.height - 115) doc.addPage();
      doc
        .moveDown(0.6)
        .font('bold')
        .fontSize(11)
        .fillColor('#16334b')
        .text(title, { width: CONTENT_WIDTH });
      doc.moveDown(0.3).font('body').fontSize(10).fillColor('#111827').text(body.trim(), {
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
      const required = Math.min(groupHeight + headingHeight + 12, pageBottom - MARGIN);
      if (doc.y + required > pageBottom) doc.addPage();
      if (index === 0) {
        doc
          .moveDown(0.6)
          .font('bold')
          .fontSize(11)
          .fillColor('#16334b')
          .text(prescriptionLabels.title, MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.3);
      }
      for (const row of rows) {
        doc
          .font(row.bold ? 'bold' : 'body')
          .fontSize(10)
          .fillColor('#111827')
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
      .fillColor('#16334b')
      .text(`Tasdiqlagan shifokor: ${data.doctorName}`);
    doc
      .font('body')
      .fontSize(9)
      .fillColor('#526272')
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

    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page += 1) {
      doc.switchToPage(page);
      doc.page.margins.bottom = 0;
      doc
        .font('body')
        .fontSize(7)
        .fillColor('#64748b')
        .text(`Hujjat ID: ${data.id}`, MARGIN, doc.page.height - 30, {
          width: CONTENT_WIDTH - 65,
          lineBreak: false,
        });
      doc.text(
        `${page - pages.start + 1} / ${pages.count}`,
        MARGIN + CONTENT_WIDTH - 60,
        doc.page.height - 30,
        { width: 60, align: 'right', lineBreak: false },
      );
    }
    doc.end();
    return result;
  }
}
