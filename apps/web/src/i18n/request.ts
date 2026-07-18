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
  'audit',
  'superadmin',
  'statuses',
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: AppLocale = routing.locales.includes(requested as AppLocale)
    ? (requested as AppLocale)
    : routing.defaultLocale;

  const entries = await Promise.all(
    MESSAGE_NAMESPACES.map(async (ns) => {
      const mod = (await import(`../../messages/${locale}/${ns}.json`)) as {
        default: Record<string, unknown>;
      };
      return [ns, mod.default] as const;
    }),
  );

  return {
    locale,
    messages: Object.fromEntries(entries) as AbstractIntlMessages,
  };
});
