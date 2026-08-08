'use client';

import { useTranslations } from 'next-intl';
import { AuthCta } from './auth-cta';
import { Reveal } from './reveal';

export function LandingFinalCta() {
  const t = useTranslations('landing');

  return (
    <section className="py-14 sm:py-24">
      <div className="container">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-primary px-5 py-12 text-center shadow-xl shadow-primary/20 sm:px-16 sm:py-16">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-24 -right-10 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
            </div>
            <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-4 sm:gap-5">
              <h2 className="text-balance text-3xl font-extrabold tracking-tight text-primary-foreground sm:text-4xl">
                {t('finalCta.title')}
              </h2>
              <p className="text-pretty text-base text-primary-foreground/90 sm:text-lg">
                {t('finalCta.subtitle')}
              </p>
              <AuthCta
                anonymousLabel={t('finalCta.button')}
                size="lg"
                variant="secondary"
                className="mt-1 h-12 w-full px-6 text-base font-semibold shadow-lg sm:mt-2 sm:w-auto sm:px-8"
              />
              <p className="text-sm text-primary-foreground/80">{t('finalCta.note')}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
