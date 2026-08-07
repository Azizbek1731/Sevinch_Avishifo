'use client';

import { useTranslations } from 'next-intl';
import { Logo } from './logo';
import { LanguageSwitcher } from './language-switcher';
import { AuthCta } from './auth-cta';

const NAV_LINKS: ReadonlyArray<{ href: string; key: string }> = [
  { href: '#features', key: 'nav.features' },
  { href: '#queue', key: 'nav.queue' },
  { href: '#why', key: 'nav.why' },
  { href: '#pricing', key: 'nav.pricing' },
];

/** Sticky, blurred top navigation with brand, section links, locale + primary CTA. */
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
          <LanguageSwitcher />
          <AuthCta anonymousLabel={t('nav.login')} size="sm" showArrow={false} target="login" />
        </div>
      </div>
    </header>
  );
}
