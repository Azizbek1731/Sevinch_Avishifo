/**
 * Resolve the patient portal base URL (no trailing slash). Priority:
 *  1. `NEXT_PUBLIC_PORTAL_URL` when set (non-empty).
 *  2. Derived from the panel's own origin in the browser:
 *     - `crm.<domain>`      → `bemor.<domain>` — the patient subdomain.
 *     - `www.<domain>` / apex → `bemor.<domain>`.
 *     - `localhost` / 127.*  → same protocol, port 3003 (dev portal app).
 * Returns '' on the server; the landing links resolve it client-side.
 */
export function resolvePortalBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_PORTAL_URL;
  if (configured && configured.trim() !== '') return configured.trim().replace(/\/+$/, '');

  if (typeof window === 'undefined') return '';

  const { protocol, hostname } = window.location;
  if (hostname === 'localhost' || hostname.startsWith('127.')) {
    return `${protocol}//${hostname}:3003`;
  }
  // The landing is served from the marketing host (apex or www) as well as from
  // the panel host, so strip whichever prefix is there before adding ours.
  const base = hostname.replace(/^(crm|www)\./, '');
  return `${protocol}//bemor.${base}`;
}
