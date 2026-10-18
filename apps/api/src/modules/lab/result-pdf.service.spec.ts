import { describe, expect, it, vi } from 'vitest';
import PDFDocument from 'pdfkit';
import { ResultFlag } from '@avishifo/shared';
import { ResultPdfService, type ResultPdfData } from './result-pdf.service';

const data: ResultPdfData = {
  clinic: { name: 'Display clinic', legalName: 'Formal test clinic', address: 'Test address', phone: '+998622001555' },
  order: {
    orderNumber: 'SYNTHETIC-001', createdAt: '2026-10-18T08:00:00.000Z', collectedAt: null,
    physiologicalState: null,
    patient: { mrn: 'TEST-001', fullName: 'Sintetik Bemor', dob: '1990-01-01', gender: 'MALE' },
    items: [],
  },
  approvedBy: { fullName: 'Sintetik Laborant' },
};

describe('laboratory PDF branding and pagination', () => {
  it('prints the saved legal name and formatted contact on an A4 document', async () => {
    const spy = vi.spyOn(PDFDocument.prototype, 'text');
    try {
      const buffer = await new ResultPdfService().render(data);
      const text = spy.mock.calls.map(([value]) => String(value)).join('\n');
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(text).toContain('Formal test clinic');
      expect(text).toContain('+998 62 200 15 55');
      expect(text).not.toContain('Display clinic');
      expect(buffer.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });

  it('repeats table headings and preserves the end of an oversized result', async () => {
    const spy = vi.spyOn(PDFDocument.prototype, 'text');
    try {
      const buffer = await new ResultPdfService().render({
        ...data,
        order: { ...data.order, items: [{
          labTest: { code: 'TEST', name: { uz: 'Sintetik tahlil' }, parameters: [{
            id: 'value-1', name: 'Izohli natija', unit: null, referenceRanges: [],
          }] },
          result: { note: null, values: [{
            parameterId: 'value-1', value: `${'Sinov matni. '.repeat(150)}FINAL-MARKER`, flag: ResultFlag.NORMAL,
          }] },
        }] },
      });
      const calls = spy.mock.calls.map(([value]) => String(value));
      expect(buffer.toString('latin1').match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
      expect(calls.filter((value) => value === 'NATIJA').length).toBeGreaterThan(1);
      expect(calls.join('\n')).toContain('FINAL-MARKER');
    } finally { spy.mockRestore(); }
  });
});
