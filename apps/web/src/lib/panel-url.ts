/**
 * Where the staff panel lives, seen from wherever the current page is served.
 *
 * The landing is a marketing site on the apex (`avishifo.uz`) while the panel is
 * a separate host (`crm.avishifo.uz`), so every clinic call-to-action has to
 * cross hosts. Kept free of React and of browser globals at module scope because
 * `middleware.ts` imports the predicates below and runs on the edge runtime.
 */

/**
 * The domain whose apex serves the landing, e.g. `avishifo.uz`. Everything the
 * host split does is anchored on this one value: without it we would be guessing
 * that some unknown host has a `crm.` sibling, and redirecting people to a
 * hostname that does not resolve.
 *
 * Unset (or a host from another domain) means "this deployment serves the
 * landing and the panel from the same origin" — which is what the legacy
 * crm.avilab.uz deployment and every dev machine do.
 */
function marketingHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_MARKETING_HOST;
  const host = raw?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host ? host.replace(/^www\./, '') : null;
}

/** Panel hosts: `crm.avishifo.uz` and the still-live legacy `crm.avilab.uz`. */
export function isPanelHostname(hostname: string): boolean {
  return hostname.toLowerCase().startsWith('crm.');
}

/** The apex or www of the domain whose landing this deployment serves. */
export function isMarketingHostname(hostname: string): boolean {
  const marketing = marketingHost();
  if (!marketing) return false;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return host === marketing;
}

/**
 * True only for the panel host of the domain we actually publish a landing for.
 * The legacy crm.avilab.uz has no separate marketing host, so it must keep
 * serving the landing at its root — otherwise deploying this change before the
 * apex DNS is switched leaves the product with no public landing page at all.
 */
export function isDedicatedPanelHostname(hostname: string): boolean {
  const marketing = marketingHost();
  if (!marketing) return false;
  return hostname.toLowerCase() === `crm.${marketing}`;
}

/**
 * Development and the bare-IP production fallback serve the landing, the panel
 * and the portal from a single origin. Host-based redirects there would make the
 * landing unreachable, so these hosts are always left alone.
 */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host.startsWith('127.')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function configuredPanelUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_PANEL_URL;
  if (!raw || raw.trim() === '') return null;
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Panel base URL (no trailing slash) for a page served from `origin`. The scheme
 * is passed in separately so the middleware can use the proxy's
 * `x-forwarded-proto` instead of the plain-HTTP scheme it sees behind nginx.
 */
export function panelBaseUrlFor(protocol: string, hostname: string, origin: string): string {
  const configured = configuredPanelUrl();
  if (configured) return configured;
  // Only the domain we publish a landing for has a panel on a different host.
  // Anywhere else — the legacy deployment, a bare IP, a dev machine, anything
  // unrecognised — one origin serves everything, and inventing a `crm.` sibling
  // would point people at a hostname that does not exist.
  const marketing = marketingHost();
  if (marketing && isMarketingHostname(hostname)) return `${protocol}//crm.${marketing}`;
  return origin;
}

/**
 * Resolve the panel base URL in the browser. Priority:
 *  1. `NEXT_PUBLIC_PANEL_URL` when set (non-empty).
 *  2. Derived from the page's own origin:
 *     - apex / `www` of NEXT_PUBLIC_MARKETING_HOST → `crm.<that host>`.
 *     - anything else → itself, one origin serves everything.
 * Returns '' on the server; the landing links resolve it client-side.
 */
export function resolvePanelBaseUrl(): string {
  const configured = configuredPanelUrl();
  if (configured) return configured;
  if (typeof window === 'undefined') return '';

  const { protocol, hostname, origin } = window.location;
  return panelBaseUrlFor(protocol, hostname, origin);
}

/**
 * TV display base URL (no trailing slash) for a page served from `origin`.
 * The panel host swaps its leading label: `crm.avishifo.uz` → `tv.avishifo.uz`.
 * It must SWAP, not prepend — prepending yields `tv.crm.avishifo.uz`, a host
 * that has no DNS record, and the QR code printed for the waiting-room screen
 * then leads nowhere.
 */
export function displayBaseUrlFor(protocol: string, hostname: string, origin: string): string {
  // Clinic LAN: the panel is on port 80 and the TV app is on 3002 of the same name or IP.
  if (process.env.NEXT_PUBLIC_LAN_MODE === 'true') {
    return `${protocol}//${hostname}:3002`;
  }
  if (hostname === 'localhost' || hostname.startsWith('127.')) {
    return `${protocol}//${hostname}:3002`;
  }
  if (isPanelHostname(hostname)) {
    return `${protocol}//tv.${hostname.slice('crm.'.length)}`;
  }
  return origin;
}

/**
 * Resolve the TV display base URL in the browser. Priority:
 *  1. `NEXT_PUBLIC_DISPLAY_URL` when set (non-empty).
 *  2. Derived from the panel's own origin — see `displayBaseUrlFor`.
 * Returns '' on the server (resolved client-side once the dialog is open).
 */
export function resolveDisplayBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DISPLAY_URL;
  if (configured && configured.trim() !== '') return configured.trim().replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';

  const { protocol, hostname, origin } = window.location;
  return displayBaseUrlFor(protocol, hostname, origin);
}
