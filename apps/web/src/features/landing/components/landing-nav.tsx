'use client';

import { useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import { Logo } from './logo';
import { LanguageSwitcher } from './language-switcher';
import { AuthCta } from './auth-cta';
import { PanelLink } from './panel-link';

const NAV_LINKS: ReadonlyArray<{ href: string; key: string }> = [
  { href: '#trial', key: 'nav.trial' },
  { href: '#features', key: 'nav.features' },
  { href: '#queue', key: 'nav.queue' },
  { href: '#why', key: 'nav.why' },
  { href: '#pricing', key: 'nav.pricing' },
];

/** Sticky, blurred top navigation with brand, section links, locale + both doors. */
export function LandingNav() {
  const t = useTranslations('landing');

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-lg supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center gap-4">
        <a href="#top" aria-label="AviShifo" className="shrink-0">
          <Logo />
        </a>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t(l.key)}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <a
            href="#patient"
            className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
          >
            <UserRound className="h-4 w-4" />
            {t('nav.patient')}
          </a>
          <LanguageSwitcher />
          {/* A plain link rather than an AuthCta so it never duplicates the
              primary button's label once a visitor is signed in. */}
          <PanelLink
            path="login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
          >
            {t('nav.login')}
          </PanelLink>
          <AuthCta anonymousLabel={t('nav.trialCta')} size="sm" showArrow={false} />
        </div>
      </div>
    </header>
  );
}
