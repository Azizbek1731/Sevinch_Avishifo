'use client';

import { useTranslations } from 'next-intl';
import { UserRound } from 'lucide-react';
import { Logo } from './logo';
import { LanguageSwitcher } from './language-switcher';
import { AuthCta } from './auth-cta';
import { PanelLink } from './panel-link';
import { LandingMobileMenu } from './landing-mobile-menu';

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
      <div className="container flex h-16 items-center gap-2 sm:gap-4">
        <a href="#top" aria-label="AviShifo" className="flex h-11 shrink-0 items-center">
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

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href="#patient"
            className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:inline-flex"
          >
            <UserRound className="h-4 w-4" />
            {t('nav.patient')}
          </a>
          <LanguageSwitcher className="hidden md:inline-flex" />
          {/* A plain link rather than an AuthCta so it never duplicates the
              primary button's label once a visitor is signed in. */}
          <PanelLink
            path="login"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:inline-flex"
          >
            {t('nav.login')}
          </PanelLink>
          {/* "7 дней бесплатно" is 150px wide: below 360px the brand, this and
              the menu trigger no longer share a row. The menu repeats it. */}
          <AuthCta
            anonymousLabel={t('nav.trialCta')}
            size="sm"
            showArrow={false}
            className="hidden h-11 px-3 text-sm min-[360px]:inline-flex md:h-8 md:text-xs"
          />
          <LandingMobileMenu links={NAV_LINKS} />
        </div>
      </div>
    </header>
  );
}
