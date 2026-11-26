import { isUltrasoundSpecialty } from '@avishifo/shared';
import type { ServiceOption } from '@/features/billing/api';

export type DoctorOption = {
  id: string;
  fullName: string;
  specialty: string | null;
};

const UZI_ROLE_TOKENS = new Set([
  'uzi',
  'utt',
  'узи',
  'узд',
  'ultrasound',
  'exo',
  'эхо',
  'echo',
  'vrach',
  'врач',
  'mutaxassisi',
]);

/** UZI / UTT / ultrasound specialists only. */
export function isUziSpecialty(specialty: string | null | undefined): boolean {
  return isUltrasoundSpecialty(specialty);
}

/**
 * Match against every stored language variant — never the display-locale
 * transliteration. Service names live in Latin `uz` (and optional `ru`/`en`);
 * Cyrillic UI transliterates for display only and must not break matching.
 */
function serviceNameHaystack(service: ServiceOption): string {
  const name = service.name;
  if (!name) return '';
  if (typeof name === 'string') return name;
  return [name.uz, name.ru, name.en].filter(Boolean).join(' ');
}

/** Significant name tokens (drops role words like UZI / EXO / vrach). */
export function doctorNameTokens(doctor: DoctorOption): string[] {
  return doctor.fullName
    .trim()
    .toLowerCase()
    .split(/[\s/·—\-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && !UZI_ROLE_TOKENS.has(part));
}

/** Levenshtein distance — used for surname typos (Otojonov ↔ Atadjonov). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur[j + 1] = Math.min(cur[j]! + 1, prev[j + 1]! + 1, prev[j]! + cost);
    }
    for (let j = 0; j < prev.length; j += 1) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

function tokenCloseEnough(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return a.length >= 4 && b.length >= 4;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 5) return false;
  const allowed = maxLen >= 8 ? 2 : 1;
  return editDistance(a, b) <= allowed;
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[\s/·—\-–,._]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

function specialtyMatchesTitle(specialty: string | null | undefined, title: string): boolean {
  if (!specialty?.trim()) return false;
  const value = specialty.trim().toLowerCase();
  if (title.includes(value)) return true;
  const hayTokens = titleTokens(title);
  const specialtyParts = titleTokens(value);
  if (specialtyParts.length === 0) return false;
  // "UZI/EXO vrach" vs title "UZI/EXO vrach — …" — enough distinctive parts hit.
  const hits = specialtyParts.filter((part) =>
    hayTokens.some((token) => tokenCloseEnough(part, token)),
  ).length;
  return hits >= Math.min(2, specialtyParts.length);
}

/** Match consultation price row named like "Specialty — Doctor Name". */
export function serviceMatchesDoctor(
  service: ServiceOption,
  doctor: DoctorOption,
  _locale?: string,
): boolean {
  const title = serviceNameHaystack(service).toLowerCase();
  const fullName = doctor.fullName.trim().toLowerCase();
  if (!fullName) return false;
  if (title.includes(fullName)) {
    if (!doctor.specialty?.trim()) return true;
    if (specialtyMatchesTitle(doctor.specialty, title)) return true;
    // Auto-created rows always embed the Latin full name; specialty script may differ.
    if (service.code?.toUpperCase().startsWith('DOC-')) return true;
    const hayTokens = titleTokens(title);
    return hayTokens.some((token) => tokenCloseEnough(doctor.specialty!.trim().toLowerCase(), token));
  }

  const doctorTokens = doctorNameTokens(doctor);
  if (doctorTokens.length === 0) return false;
  const hayTokens = titleTokens(title);

  const matchedTokens = doctorTokens.filter((part) =>
    hayTokens.some((token) => tokenCloseEnough(part, token)),
  );
  if (matchedTokens.length === 0) return false;

  // Prefer full-name hits; allow a single distinctive token when specialty (or DOC- row)
  // already pins the row to this doctor — e.g. "UZI/EXO vrach — Sherzod".
  const nameHit =
    matchedTokens.length === doctorTokens.length ||
    (matchedTokens.length >= 1 &&
      (specialtyMatchesTitle(doctor.specialty, title) ||
        Boolean(service.code?.toUpperCase().startsWith('DOC-'))));
  if (!nameHit) return false;
  if (!doctor.specialty?.trim()) return true;
  if (specialtyMatchesTitle(doctor.specialty, title)) return true;
  return Boolean(service.code?.toUpperCase().startsWith('DOC-'));
}

/**
 * Ultrasound catalogues are split per doctor (category name carries the doctor).
 * Falls back to service title match when category is absent.
 */
export function uziServiceMatchesDoctor(
  service: ServiceOption,
  doctor: DoctorOption,
  _locale?: string,
): boolean {
  const rawCategory = service.category?.name;
  const categoryName =
    typeof rawCategory === 'string'
      ? rawCategory
      : rawCategory && typeof rawCategory === 'object'
        ? [rawCategory.uz, rawCategory.ru, rawCategory.en].filter(Boolean).join(' ')
        : '';
  const haystack = `${categoryName} ${serviceNameHaystack(service)}`.toLowerCase();
  const fullName = doctor.fullName.trim().toLowerCase();
  if (!fullName) return false;
  if (haystack.includes(fullName)) return true;
  const tokens = doctorNameTokens(doctor);
  if (tokens.length === 0) return false;
  const hayTokens = titleTokens(haystack);
  // One distinctive name token in the per-doctor UZI category is enough
  // ("UZI EXO — Sherzod" ↔ "Abdullayev Sherzod Uzi").
  return tokens.some((token) => hayTokens.some((hay) => tokenCloseEnough(token, hay)));
}

export function findDoctorConsultationService(
  services: ServiceOption[],
  doctor: DoctorOption,
  locale?: string,
): ServiceOption | undefined {
  return services.find((service) => serviceMatchesDoctor(service, doctor, locale));
}

/**
 * Search queries that can uncover a consultation row when the catalogue spelling
 * differs slightly from the staff card (surname typo, missing middle name, …).
 */
export function consultationSearchQueries(doctor: DoctorOption): string[] {
  const queries: string[] = [];
  const fullName = doctor.fullName.trim();
  if (fullName) queries.push(fullName);
  const tokens = doctorNameTokens(doctor);
  for (const token of tokens) {
    if (!queries.some((q) => q.toLowerCase() === token)) queries.push(token);
  }
  const specialty = doctor.specialty?.trim();
  if (specialty && !queries.some((q) => q.toLowerCase() === specialty.toLowerCase())) {
    queries.push(specialty);
  }
  return queries;
}

/** Prefill for free-text cashier line when no catalogue row exists. */
export function manualConsultationTitle(doctor: DoctorOption): string {
  const name = doctor.fullName.trim();
  const specialty = doctor.specialty?.trim();
  if (specialty && name) return `${specialty} — ${name}`;
  if (name) return `Shifokor qabuli — ${name}`;
  return 'Shifokor qabuli';
}

/**
 * Cardiologist desks (e.g. Abdullayev Arslon): ~90% of consults also need EKG,
 * so the reception / ambulatory UI offers it next to the consultation.
 */
export function doctorSuggestsEkg(doctor: Pick<DoctorOption, 'fullName' | 'specialty'> | null | undefined): boolean {
  if (!doctor) return false;
  const specialty = (doctor.specialty ?? '').toLowerCase();
  if (/kardiolog|кардиолог|cardiolog/.test(specialty)) return true;
  const name = doctor.fullName.toLowerCase();
  return /arslon|арслон/.test(name) && /abdullayev|абдуллаев|абдуллаев/.test(name);
}

/** Catalogue row for resting ECG (not Holter). */
export function isEkgService(service: ServiceOption): boolean {
  const code = (service.code ?? '').toUpperCase();
  if (code === 'DIAG-01' || /^EKG\b/.test(code)) return true;
  const hay = serviceNameHaystack(service).toLowerCase();
  if (/холтер|holter|xolter/.test(hay)) return false;
  return /\bekg\b|\becg\b|электрокардиограф|elektrokardiograf/.test(hay);
}
