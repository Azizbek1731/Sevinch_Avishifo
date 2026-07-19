/**
 * A value that may be a plain string or a multilingual { uz, ru, en } object.
 * Invoice line titles and service names are stored as JSON and can be either
 * form, so rendering them requires this narrowing (a raw object thrown at React
 * is the classic "Objects are not valid as a React child" #31 crash).
 */
export type Localizable =
  | string
  | { uz?: string | null; ru?: string | null; en?: string | null }
  | null
  | undefined;

/** Pick the best string for `locale`, falling back uz → ru → en → `fallback`. */
export function localizedText(value: Localizable, locale: string, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const primary = locale === 'ru' ? value.ru : locale === 'en' ? value.en : value.uz;
    return primary || value.uz || value.ru || value.en || fallback;
  }
  return fallback;
}
