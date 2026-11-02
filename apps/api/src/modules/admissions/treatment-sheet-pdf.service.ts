import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  CLINIC_PDF_COLORS,
  drawClinicLetterhead,
  drawClinicPageFurniture,
  preparePdfClinicLogo,
  type PdfClinicProfile,
} from '../../common/pdf/clinic-letterhead';

export interface TreatmentSheetPdfData {
  clinic: PdfClinicProfile;
  patient: {
    fullName: string;
    mrn: string;
    dob: string | null;
    phone: string | null;
  };
  admission: {
    historyNumber: string;
    department: string | null;
    ward: string | null;
    bed: string | null;
    admittedAt: string;
    dischargedAt: string | null;
    status: string;
  };
  doctorName: string | null;
  orders: Array<{
    title: string;
    schedule: string;
    timesPerDay: number;
    days: Array<{ date: string; slots: Array<{ slot: number; status: string | null }> }>;
  }>;
}

const FONT = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
const MARGIN = 48;
const CONTENT_WIDTH = 595.28 - MARGIN * 2;

function slotMark(status: string | null): string {
  if (status === 'GIVEN') return '✓';
  if (status === 'SKIPPED') return '–';
  return '·';
}

function pickLocalized(name: unknown): string {
  if (name && typeof name === 'object' && !Array.isArray(name)) {
    const n = name as Record<string, unknown>;
    for (const key of ['uz', 'ru', 'en']) {
      if (typeof n[key] === 'string' && n[key]) return n[key] as string;
    }
  }
  return typeof name === 'string' ? name : 'Muolaja';
}

/** Server PDF of the inpatient treatment sheet — same channel as lab/UZI Telegram delivery. */
@Injectable()
export class TreatmentSheetPdfService {
  async render(data: TreatmentSheetPdfData): Promise<Buffer> {
    const logo = await preparePdfClinicLogo(data.clinic.logoUrl);
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: `Muolaja varaqasi — ${data.admission.historyNumber}`,
        Author: data.clinic.name,
      },
    });
    doc.registerFont('body', FONT);
    doc.registerFont('bold', BOLD);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    drawClinicLetterhead(doc, data.clinic, logo, MARGIN);
    doc.font('bold').fontSize(14).fillColor(CLINIC_PDF_COLORS.ink).text('Muolaja varaqasi', {
      align: 'center',
    });
    doc.moveDown(0.4);
    doc
      .font('body')
      .fontSize(9)
      .fillColor(CLINIC_PDF_COLORS.muted)
      .text(`Kasallik tarixi: ${data.admission.historyNumber}`, { align: 'center' });
    doc.moveDown(0.8);

    const info: Array<[string, string]> = [
      ['Bemor', data.patient.fullName],
      ['Karta', data.patient.mrn],
      ['Tug‘ilgan sana', data.patient.dob ?? '—'],
      ['Telefon', data.patient.phone ?? '—'],
      [
        'Bo‘lim / palata',
        [data.admission.department, data.admission.ward, data.admission.bed]
          .filter(Boolean)
          .join(' · ') || '—',
      ],
      ['Yotqizilgan', data.admission.admittedAt.slice(0, 10)],
      ['Chiqarilgan', data.admission.dischargedAt?.slice(0, 10) ?? '—'],
      ['Shifokor', data.doctorName ?? '—'],
    ];
    for (const [label, value] of info) {
      doc.font('bold').fontSize(9).fillColor(CLINIC_PDF_COLORS.muted).text(`${label}: `, {
        continued: true,
      });
      doc.font('body').fillColor(CLINIC_PDF_COLORS.ink).text(value);
    }

    doc.moveDown(0.6);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + CONTENT_WIDTH, doc.y)
      .lineWidth(0.6)
      .strokeColor(CLINIC_PDF_COLORS.rule)
      .stroke();
    doc.moveDown(0.5);

    if (!data.orders.length) {
      doc
        .font('body')
        .fontSize(10)
        .fillColor(CLINIC_PDF_COLORS.muted)
        .text('Muolaja buyurtmalari yo‘q.');
    } else {
      doc.font('bold').fontSize(11).fillColor(CLINIC_PDF_COLORS.ink).text('Tayinlovlar');
      doc.moveDown(0.4);
      for (const order of data.orders) {
        this.ensureSpace(doc, 56);
        doc.font('bold').fontSize(10).fillColor(CLINIC_PDF_COLORS.blue).text(order.title);
        doc
          .font('body')
          .fontSize(8)
          .fillColor(CLINIC_PDF_COLORS.muted)
          .text(
            `Jadval: ${order.schedule} · Kuniga ${order.timesPerDay} marta`,
          );
        doc.moveDown(0.2);
        for (const day of order.days) {
          this.ensureSpace(doc, 16);
          const marks = day.slots.map((slot) => `${slot.slot}:${slotMark(slot.status)}`).join('  ');
          doc
            .font('body')
            .fontSize(9)
            .fillColor(CLINIC_PDF_COLORS.ink)
            .text(`${day.date}    ${marks}`);
        }
        doc.moveDown(0.45);
      }
      doc
        .font('body')
        .fontSize(8)
        .fillColor(CLINIC_PDF_COLORS.muted)
        .text('Belgilar: ✓ berilgan · – o‘tkazib yuborilgan · · hali belgilanmagan');
    }

    drawClinicPageFurniture(doc, data.clinic, {
      margin: MARGIN,
      documentLabel: 'Muolaja varaqasi',
    });
    doc.end();
    return done;
  }

  pickServiceTitle(name: unknown): string {
    return pickLocalized(name);
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
    if (doc.y + needed < doc.page.height - MARGIN - 48) return;
    doc.addPage();
    doc.y = MARGIN + 36;
  }
}
