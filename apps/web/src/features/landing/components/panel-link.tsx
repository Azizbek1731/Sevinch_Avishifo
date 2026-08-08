'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { resolvePanelBaseUrl } from '@/lib/panel-url';

/** The only panel pages the landing ever links to. */
export type PanelPath = 'login' | 'register';

/**
 * Absolute URL of a panel page, or `null` while it is unknown — the panel host is
 * derived from `window.location`, so it only exists after mount — and also when
 * the panel IS this origin (dev, bare IP). Callers render an in-app `<Link>`
 * then: it works during SSR and without JS, and on the marketing host the
 * middleware forwards `/<locale>/login` to the panel anyway.
 */
export function usePanelUrl(path: PanelPath): string | null {
  const locale = useLocale();
  const [base, setBase] = useState<string | null>(null);

  useEffect(() => {
    const resolved = resolvePanelBaseUrl();
    setBase(resolved && resolved !== window.location.origin ? resolved : null);
  }, []);

  return base ? `${base}/${locale}/${path}` : null;
}

/** Plain text link to a panel page, for nav, footer and the mobile menu. */
export function PanelLink({
  path,
  className,
  onClick,
  children,
}: {
  path: PanelPath;
  className?: string;
  /** Lets an overlay close itself before the browser leaves the page. */
  onClick?: () => void;
  children: ReactNode;
}) {
  const href = usePanelUrl(path);

  if (href) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={`/${path}`} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
