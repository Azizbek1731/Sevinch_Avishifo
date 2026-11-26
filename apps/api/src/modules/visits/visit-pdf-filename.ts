import { formatInTimeZone } from 'date-fns-tz';
import { TIMEZONE } from '@avishifo/shared';

/** Safe ASCII fallback for Content-Disposition filename= */
function asciiSlug(value: string): string {
  const mapped = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return mapped.slice(0, 60) || 'report';
}

/** Human filename with Unicode (Cyrillic/Uzbek) for filename*=UTF-8'' */
function displaySlug(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'report';
}

export type VisitPdfNameInput = {
  patientFullName: string;
  patientMrn?: string | null;
  confirmedAt: string;
  kind: 'CONSULTATION' | 'ULTRASOUND';
  mode?: 'summary' | 'prescription';
};

/**
 * Download name: FISH_sana_tur.pdf
 * e.g. Allamova_Fazilat_2026-11-25_UZI_xulosa.pdf
 */
export function visitPdfFilename(input: VisitPdfNameInput): {
  ascii: string;
  utf8: string;
  header: string;
} {
  const date = formatInTimeZone(input.confirmedAt, TIMEZONE, 'yyyy-MM-dd');
  const name = displaySlug(input.patientFullName);
  const kind =
    input.mode === 'prescription'
      ? 'Retsept'
      : input.kind === 'ULTRASOUND'
        ? 'UZI_xulosa'
        : 'Klinik_xulosa';
  const utf8 = `${name}_${date}_${kind}.pdf`;
  const asciiBase = asciiSlug(input.patientFullName);
  const ascii =
    asciiBase !== 'report'
      ? `${asciiBase}_${date}_${kind}.pdf`
      : `${asciiSlug(input.patientMrn ?? 'bemor')}_${date}_${kind}.pdf`;
  const header = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utf8)}`;
  return { ascii, utf8, header };
}
