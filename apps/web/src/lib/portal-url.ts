/**
 * A real portal URL the server can render before `window` exists. Without it the
 * patient buttons ship as dead placeholders in the HTML and stay dead until
 * hydration — or forever, with JavaScript off. On the legacy single-origin
 * deployment this points at the other domain's portal, which is live and
 * correct; hydration then refines it to that deployment's own portal host.
 */
export function portalBaseUrlFallback(): string {
  const configured = process.env.NEXT_PUBLIC_PORTAL_URL;
  if (configured && configured.trim() !== '') return configured.trim().replace(/\/+$/, '');
  const marketing = process.env.NEXT_PUBLIC_MARKETING_HOST?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  return marketing ? `https://bemor.${marketing}` : '';
}

/**
 * Resolve the patient portal base URL (no trailing slash). Priority:
 *  1. `NEXT_PUBLIC_PORTAL_URL` when set (non-empty).
 *  2. Derived from the page's own origin in the browser:
 *     - `crm.<domain>` / `www.<domain>` / apex → `bemor.<domain>`.
 *     - `localhost` / 127.*  → same protocol, port 3003 (dev portal app).
 * Returns '' on the server — call `portalBaseUrlFallback()` for the first paint.
 */
export function resolvePortalBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_PORTAL_URL;
  if (configured && configured.trim() !== '') return configured.trim().replace(/\/+$/, '');

  if (typeof window === 'undefined') return '';

  const { protocol, hostname } = window.location;
  if (process.env.NEXT_PUBLIC_LAN_MODE === 'true') {
    return `${protocol}//${hostname}:3003`;
  }
  if (hostname === 'localhost' || hostname.startsWith('127.')) {
    return `${protocol}//${hostname}:3003`;
  }
  // The landing is served from the marketing host (apex or www) as well as from
  // the panel host, so strip whichever prefix is there before adding ours.
  const base = hostname.replace(/^(crm|www)\./, '');
  return `${protocol}//bemor.${base}`;
}
