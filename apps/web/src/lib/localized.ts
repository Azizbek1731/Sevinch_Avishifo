import { transliterateUzLatn } from './uz-cyrillic';

/**
 * A value that may be a plain string or a multilingual { uz, ru, en } object.
 * Invoice line titles and service names are stored as JSON and can be either
 * form, so rendering them requires this narrowing (a raw object thrown at React
 * is the classic "Objects are not valid as a React child" #31 crash).
 */
export type Localizable =
  string | { uz?: string | null; ru?: string | null; en?: string | null } | null | undefined;

/**
 * Pick the string for `locale`.
 * ru/en use their stored translation, then Uzbek.
 * uz-Cyrl has no stored column: the Latin Uzbek name is transliterated.
 */
export function localizedText(value: Localizable, locale: string, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    return locale === 'uz-Cyrl' ? transliterateUzLatn(value) : value;
  }
  if (typeof value === 'object') {
    if (locale === 'ru' && value.ru) return value.ru;
    if (locale === 'en' && value.en) return value.en;
    const uz = value.uz || value.ru || value.en || fallback;
    if (locale === 'uz-Cyrl') return transliterateUzLatn(uz);
    return uz || fallback;
  }
  return fallback;
}
