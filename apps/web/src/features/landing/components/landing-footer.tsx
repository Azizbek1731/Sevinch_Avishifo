'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Logo } from './logo';
import { PanelLink } from './panel-link';

/**
 * A thumb-sized row on a phone, a plain line of text from `md` up — a pointer
 * does not need 44px of slack and the desktop column would sprawl.
 */
const FOOTER_LINK =
  'flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground md:min-h-0';

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={FOOTER_LINK}>
      {children}
    </a>
  );
}

export function LandingFooter() {
  const t = useTranslations('landing');

  return (
    <footer className="border-t border-border bg-card/40">
      <div className="container py-10 sm:py-14">
        {/* Two columns on a phone: with 44px rows a single stack of eleven links
            is a screen and a half of nothing but the footer. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:gap-10 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="col-span-2 max-w-sm md:col-span-1">
            <Logo />
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:mt-4">
              {t('footer.tagline')}
            </p>
          </div>

          <div className="flex flex-col md:gap-3">
            <p className="flex min-h-11 items-center text-sm font-semibold text-foreground md:min-h-0">
              {t('footer.productTitle')}
            </p>
            <FooterLink href="#features">{t('footer.links.features')}</FooterLink>
            <FooterLink href="#queue">{t('footer.links.queue')}</FooterLink>
            <FooterLink href="#pricing">{t('footer.links.pricing')}</FooterLink>
            <FooterLink href="#trial">{t('footer.links.trial')}</FooterLink>
            <FooterLink href="#patient">{t('footer.links.patient')}</FooterLink>
            <PanelLink path="login" className={FOOTER_LINK}>
              {t('footer.links.login')}
            </PanelLink>
          </div>

          <div className="flex flex-col md:gap-3">
            <p className="flex min-h-11 items-center text-sm font-semibold text-foreground md:min-h-0">
              {t('footer.companyTitle')}
            </p>
            <FooterLink href="#top">{t('footer.links.about')}</FooterLink>
            <FooterLink href="#top">{t('footer.links.contact')}</FooterLink>
            <FooterLink href="#features">{t('footer.links.docs')}</FooterLink>
          </div>

          <div className="flex flex-col md:gap-3">
            <p className="flex min-h-11 items-center text-sm font-semibold text-foreground md:min-h-0">
              {t('footer.legalTitle')}
            </p>
            <FooterLink href="#top">{t('footer.links.privacy')}</FooterLink>
            <FooterLink href="#top">{t('footer.links.terms')}</FooterLink>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground sm:mt-12">
          {t('footer.rights')}
        </div>
      </div>
    </footer>
  );
}
