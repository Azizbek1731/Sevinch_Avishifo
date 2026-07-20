'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Logo } from './logo';

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </a>
  );
}

export function LandingFooter() {
  const t = useTranslations('landing');

  return (
    <footer className="border-t border-border bg-card/40">
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t('footer.tagline')}</p>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">{t('footer.productTitle')}</p>
            <FooterLink href="#features">{t('footer.links.features')}</FooterLink>
            <FooterLink href="#queue">{t('footer.links.queue')}</FooterLink>
            <FooterLink href="#top">{t('footer.links.pricing')}</FooterLink>
            <Link
              href="/login"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('footer.links.login')}
            </Link>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">{t('footer.companyTitle')}</p>
            <FooterLink href="#top">{t('footer.links.about')}</FooterLink>
            <FooterLink href="#top">{t('footer.links.contact')}</FooterLink>
            <FooterLink href="#features">{t('footer.links.docs')}</FooterLink>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">{t('footer.legalTitle')}</p>
            <FooterLink href="#top">{t('footer.links.privacy')}</FooterLink>
            <FooterLink href="#top">{t('footer.links.terms')}</FooterLink>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          {t('footer.rights')}
        </div>
      </div>
    </footer>
  );
}
