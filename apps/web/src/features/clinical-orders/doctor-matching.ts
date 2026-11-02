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
  if (!specialty) return false;
  const value = specialty.toLowerCase();
  return (
    value.includes('uzi') ||
    value.includes('utt') ||
    value.includes('узи') ||
    value.includes('узд') ||
    value.includes('ultrasound') ||
    value.includes('exo') ||
    value.includes('эхо')
  );
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
    const specialty = doctor.specialty.trim().toLowerCase();
    if (title.includes(specialty)) return true;
    // Auto-created rows always embed the Latin full name; specialty script may differ.
    if (service.code?.toUpperCase().startsWith('DOC-')) return true;
    const hayTokens = titleTokens(title);
    return hayTokens.some((token) => tokenCloseEnough(specialty, token));
  }

  const doctorTokens = doctorNameTokens(doctor);
  if (doctorTokens.length === 0) return false;
  const hayTokens = titleTokens(title);

  // Every doctor name token must appear in the title (exact or near-miss typo).
  const nameHit = doctorTokens.every((part) =>
    hayTokens.some((token) => tokenCloseEnough(part, token)),
  );
  if (!nameHit) return false;
  if (!doctor.specialty?.trim()) return true;
  const specialty = doctor.specialty.trim().toLowerCase();
  if (title.includes(specialty) || hayTokens.some((token) => tokenCloseEnough(specialty, token))) {
    return true;
  }
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
  const haystack = `${service.category?.name ?? ''} ${serviceNameHaystack(service)}`.toLowerCase();
  const fullName = doctor.fullName.trim().toLowerCase();
  if (!fullName) return false;
  if (haystack.includes(fullName)) return true;
  const tokens = doctorNameTokens(doctor);
  if (tokens.length === 0) return false;
  const hayTokens = titleTokens(haystack);
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
