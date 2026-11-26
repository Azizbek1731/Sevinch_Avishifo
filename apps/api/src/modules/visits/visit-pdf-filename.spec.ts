import { describe, expect, it } from 'vitest';
import { visitPdfFilename } from './visit-pdf-filename';

describe('visitPdfFilename', () => {
  it('builds FISH_date_UZI_xulosa.pdf with UTF-8 disposition', () => {
    const named = visitPdfFilename({
      patientFullName: 'Алламова Фазилат',
      patientMrn: 'P-000915',
      confirmedAt: '2026-11-25T10:00:00.000Z',
      kind: 'ULTRASOUND',
    });
    expect(named.utf8).toBe('Алламова_Фазилат_2026-11-25_UZI_xulosa.pdf');
    expect(named.header).toContain('filename*=UTF-8\'\'');
    expect(named.header).toContain(encodeURIComponent(named.utf8));
    expect(named.ascii).toMatch(/_2026-11-25_UZI_xulosa\.pdf$/);
  });

  it('uses Retsept for prescription mode', () => {
    const named = visitPdfFilename({
      patientFullName: 'Sinov Bemor',
      confirmedAt: '2026-11-25T10:00:00.000Z',
      kind: 'CONSULTATION',
      mode: 'prescription',
    });
    expect(named.utf8).toBe('Sinov_Bemor_2026-11-25_Retsept.pdf');
  });
});
