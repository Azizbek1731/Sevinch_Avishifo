import { describe, expect, it, vi } from 'vitest';
import PDFDocument from 'pdfkit';
import { VisitReportPdfService, type VisitReportPdfData } from './visit-report-pdf.service';
import { buildVisitReportPdfData } from './visit-report.data';

const report: VisitReportPdfData = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'ULTRASOUND',
  title: 'UZI xulosasi',
  body: 'Sintetik test xulosasi. Синтетический текст.',
  clinic: { name: 'Sinov klinikasi', legalName: null, address: null, phone: null },
  patient: { fullName: 'Sinov Bemor', mrn: 'TEST-001', dob: '1990-01-01' },
  doctorName: 'Sinov Shifokor',
  confirmedAt: '2026-10-11T10:00:00.000Z',
  subjective: null,
  objective: null,
  assessmentNote: null,
  plan: null,
  diagnoses: [],
  prescriptions: [],
};

describe('confirmed clinical report PDF', () => {
  it('produces a Unicode-capable PDF for a confirmed UZI report', async () => {
    const result = await new VisitReportPdfService().render(report);
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.length).toBeGreaterThan(1000);
    expect(result.toString('latin1')).toContain('/FontFile2');
  });

  it('paginates a long consultation without dropping its later paragraphs', async () => {
    const result = await new VisitReportPdfService().render({
      ...report,
      kind: 'CONSULTATION',
      body: Array.from(
        { length: 250 },
        (_, index) => `${index + 1}. Test xulosa: bemorning ko‘rigi va shifokor tavsiyalari.\n`,
      ).join('\n'),
    });
    const pages = result.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(3);
  });

  it('refuses to build a signed report from an in-progress visit', () => {
    const draft = { status: 'IN_PROGRESS', completedAt: null } as Parameters<
      typeof buildVisitReportPdfData
    >[0];
    expect(() => buildVisitReportPdfData(draft, report.clinic)).toThrow('Only a confirmed visit');
  });

  it('renders one Rp. per mixture, keeps legacy directions and includes physiotherapy', async () => {
    const text = vi.spyOn(PDFDocument.prototype, 'text');
    try {
      await new VisitReportPdfService().render({
        ...report,
        kind: 'CONSULTATION',
        title: null,
        body: null,
        prescriptions: [
          {
            drugName: 'Sol. Natrii chloridi',
            strength: '0,9% - 200 ml',
            quantity: 'N. 5',
            form: 'flac.',
            dosage: '200 ml',
            route: 'v/i',
            dripRate: '30',
            frequency: 'kuniga 1 marta',
            durationDays: 9,
            durationText: '3-5 kun',
            instructions: 'Sekin yuborilsin',
          },
          {
            drugName: 'Sol. Acidi ascorbinici',
            strength: '5% - 2 ml',
            combineWithPrevious: true,
            dosage: 'CHILD DIRECTIONS MUST NOT PRINT',
            instructions: 'CHILD NOTE MUST NOT PRINT',
          },
          {
            drugName: 'Legacy medicine',
            dosage: '1 tabletka',
            frequency: 'kechqurun',
            durationDays: 7,
          },
        ],
        physiotherapy: 'Fizioterapiya bo‘yicha shifokor yozuvi. Синтетический текст.',
      });
      const rendered = text.mock.calls.map(([value]) => String(value)).join('\n');
      expect(rendered).toContain('Rp.: Sol. Natrii chloridi 0,9% - 200 ml');
      expect(rendered).toContain('Sol. Acidi ascorbinici 5% - 2 ml');
      expect(rendered).not.toContain('Rp.: Sol. Acidi ascorbinici');
      expect(rendered).toContain('M. D.t.d. N. 5 in flac.');
      expect(rendered).toContain(
        'S.: 200 ml, v/i, 30 tomchi/daqiqa, kuniga 1 marta, 3-5 kun, Sekin yuborilsin',
      );
      expect(rendered).toContain('S.: 1 tabletka, kechqurun, 7 kun');
      expect(rendered).toContain('Fizioterapiya bo‘yicha shifokor yozuvi. Синтетический текст.');
      expect(rendered).not.toContain('CHILD DIRECTIONS');
      expect(rendered).not.toContain('CHILD NOTE');
    } finally {
      text.mockRestore();
    }
  });

  it('paginates an oversized prescription without losing its final component or instructions', async () => {
    const text = vi.spyOn(PDFDocument.prototype, 'text');
    try {
      const result = await new VisitReportPdfService().render({
        ...report,
        kind: 'CONSULTATION',
        title: null,
        body: null,
        prescriptions: Array.from({ length: 90 }, (_, index) => ({
          drugName: `SYNTHETIC COMPONENT ${index + 1}`,
          strength: 'Synthetic strength text',
          combineWithPrevious: index > 0,
          instructions: index === 0 ? 'BASE INSTRUCTIONS AT END OF LARGE GROUP' : null,
        })),
        physiotherapy: 'PHYSIOTHERAPY AFTER LARGE GROUP',
      });
      const rendered = text.mock.calls.map(([value]) => String(value)).join('\n');
      expect(result.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(2);
      expect(rendered).toContain('SYNTHETIC COMPONENT 90 Synthetic strength text');
      expect(rendered).toContain('S.: BASE INSTRUCTIONS AT END OF LARGE GROUP');
      expect(rendered).toContain('PHYSIOTHERAPY AFTER LARGE GROUP');
    } finally {
      text.mockRestore();
    }
  });

  it('keeps original confirmation separate from the latest audited correction', () => {
    const confirmed = {
      id: report.id,
      kind: 'ULTRASOUND',
      status: 'COMPLETED',
      completedAt: new Date(report.confirmedAt),
      reportTitle: report.title,
      reportBody: 'Tuzatilgan xulosa',
      patient: { fullName: 'Sinov Bemor', mrn: 'TEST-001', dob: null },
      doctor: { fullName: 'Sinov Shifokor' },
      subjective: null,
      objective: null,
      assessmentNote: null,
      plan: null,
      diagnoses: [],
      prescriptions: [],
      amendments: [
        {
          createdAt: new Date('2026-10-12T10:00:00Z'),
          authorId: 'doctor-2',
          reason: 'Xatoni tuzatish',
        },
      ],
    } as unknown as Parameters<typeof buildVisitReportPdfData>[0];
    const data = buildVisitReportPdfData(confirmed, report.clinic, {
      fullName: 'Tuzatgan Shifokor',
    });
    expect(data.confirmedAt).toBe(report.confirmedAt);
    expect(data.latestAmendment).toEqual({
      at: '2026-10-12T10:00:00.000Z',
      authorName: 'Tuzatgan Shifokor',
      reason: 'Xatoni tuzatish',
    });
  });

  it('carries all saved prescription fields into the same report used for patient delivery', () => {
    const prescription = {
      drugName: 'Original physician name',
      dosage: 'Original dose',
      strength: 'Original strength',
      form: 'Original form',
      quantity: 'Original quantity',
      route: 'Original route',
      frequency: 'Original frequency',
      durationDays: 5,
      durationText: 'Original duration',
      dripRate: '30',
      instructions: 'Original instructions',
      combineWithPrevious: true,
      sortOrder: 1,
    };
    const confirmed = {
      id: report.id,
      kind: 'CONSULTATION',
      status: 'COMPLETED',
      completedAt: new Date(report.confirmedAt),
      reportTitle: null,
      reportBody: null,
      patient: { fullName: report.patient.fullName, mrn: report.patient.mrn, dob: null },
      doctor: { fullName: report.doctorName },
      subjective: null,
      objective: null,
      assessmentNote: null,
      plan: null,
      physiotherapy: 'Saved physiotherapy',
      diagnoses: [],
      prescriptions: [prescription],
      amendments: [],
    } as unknown as Parameters<typeof buildVisitReportPdfData>[0];
    const data = buildVisitReportPdfData(confirmed, report.clinic);
    expect(data.prescriptions).toEqual([prescription]);
    expect(data.physiotherapy).toBe('Saved physiotherapy');
  });
});
