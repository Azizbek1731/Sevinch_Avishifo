import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { routing, type AppLocale } from './routing';

/** Each namespace lives in its own file: messages/<locale>/<ns>.json */
export const MESSAGE_NAMESPACES = [
  'common',
  'auth',
  'nav',
  'errors',
  'dashboard',
  'reception',
  'patients',
  'appointments',
  'queue',
  'doctor',
  'visits',
  'services',
  'billing',
  'cashier',
  'lab',
  'reports',
  'staff',
  'notifications',
  'settings',
  'feedback',
  'help',
  'audit',
  'superadmin',
  'statuses',
  'landing',
  'subscription',
  'security',
  'recordAccess',
  'ai',
  'expenses',
  'charges',
  'admissions',
  'admissionPrint',
  'cardPrint',
] as const;

/**
 * Load one namespace for a locale, falling back to the default locale when that
 * locale has not been translated yet (e.g. an auto-generated `uz-Cyrl/<ns>.json`
 * that is added later). This keeps every locale renderable instead of crashing on
 * a missing message file.
 */
async function loadNamespace(
  locale: AppLocale,
  ns: (typeof MESSAGE_NAMESPACES)[number],
): Promise<Record<string, unknown>> {
  try {
    const mod = (await import(`../../messages/${locale}/${ns}.json`)) as {
      default: Record<string, unknown>;
    };
    return mod.default;
  } catch {
    const fallback = (await import(`../../messages/${routing.defaultLocale}/${ns}.json`)) as {
      default: Record<string, unknown>;
    };
    return fallback.default;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: AppLocale = routing.locales.includes(requested as AppLocale)
    ? (requested as AppLocale)
    : routing.defaultLocale;

  const entries = await Promise.all(
    MESSAGE_NAMESPACES.map(async (ns) => [ns, await loadNamespace(locale, ns)] as const),
  );

  return {
    locale,
    messages: Object.fromEntries(entries) as AbstractIntlMessages,
  };
});
