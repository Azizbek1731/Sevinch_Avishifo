import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import {
  isDedicatedPanelHostname,
  isLocalHostname,
  isMarketingHostname,
  panelBaseUrlFor,
} from './lib/panel-url';

const intlMiddleware = createMiddleware(routing);

/** Auth pages that are canonical on the panel host, never on the marketing one. */
const PANEL_PATHS = ['login', 'register'] as const;

const LOCALES = routing.locales.join('|');
/** `/uz` or `/uz/` — the landing root for one locale. */
const LOCALE_ROOT = new RegExp(`^/(${LOCALES})/?$`);
/** `/uz/login`, `/ru/register/` — exactly the auth pages, nothing beneath them. */
const PANEL_PATH = new RegExp(`^/(${LOCALES})/(${PANEL_PATHS.join('|')})/?$`);

/**
 * The host the visitor actually typed.
 *
 * `nextUrl.hostname` is NOT it: behind `next start` the URL is rebuilt from the
 * socket, so every proxied request looks like it arrived at 127.0.0.1 and the
 * whole host split silently does nothing. nginx forwards the real name in both
 * `X-Forwarded-Host` and `Host`, so read those, in that order.
 */
function externalHostname(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || request.headers.get('host') || request.nextUrl.hostname;
  // Strip the port, and the brackets an IPv6 literal arrives in.
  return host.replace(/^\[(.+)\]$/, '$1').replace(/:\d+$/, '').toLowerCase();
}

/** nginx terminates TLS, so the scheme the app sees is plain http. */
function externalProtocol(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return forwarded === 'https' || forwarded === 'http'
    ? `${forwarded}:`
    : request.nextUrl.protocol;
}

/**
 * Splits the two production host families before next-intl sees the request:
 * on the domain we publish a landing for, `crm.<domain>` is the panel and has no
 * marketing page, while the apex and `www` are the landing and have no auth
 * pages.
 *
 * Every other host — the legacy deployment that serves both from one origin, a
 * bare IP, a dev machine — is passed straight through. That is deliberate: a
 * blanket `crm.*` rule would strip the landing off the legacy domain, and until
 * the apex DNS is switched that domain is the only place the landing is
 * reachable at all.
 */
export default function middleware(request: NextRequest) {
  const { nextUrl } = request;
  const hostname = externalHostname(request);

  if (isLocalHostname(hostname)) return intlMiddleware(request);

  if (isDedicatedPanelHostname(hostname)) {
    const locale = LOCALE_ROOT.exec(nextUrl.pathname)?.[1];
    if (locale) {
      // Same reason as externalHostname: nextUrl.clone() would send the visitor
      // to http://127.0.0.1:3000/uz/login.
      const target = new URL(
        `/${locale}/login`,
        `${externalProtocol(request)}//${request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || nextUrl.host}`,
      );
      target.search = nextUrl.search;
      return NextResponse.redirect(target, 307);
    }
    // A bare `/` still has no locale. next-intl answers it with a redirect to
    // `/<negotiated-locale>`, which comes back through the branch above — one
    // extra hop, but the locale negotiation and its cookie stay untouched.
    return intlMiddleware(request);
  }

  const auth = isMarketingHostname(hostname) ? PANEL_PATH.exec(nextUrl.pathname) : null;
  if (auth) {
    const panel = panelBaseUrlFor(
      externalProtocol(request),
      hostname,
      `${externalProtocol(request)}//${hostname}`,
    );
    const target = new URL(`/${auth[1]}/${auth[2]}`, panel);
    target.search = nextUrl.search;
    // A NEXT_PUBLIC_PANEL_URL pointing back at this host would redirect to
    // itself forever; serve the page locally instead of looping.
    if (target.hostname !== hostname) return NextResponse.redirect(target, 308);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
