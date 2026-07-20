'use client';

import { useTranslations } from 'next-intl';
import { AuthCta } from './auth-cta';
import { Reveal } from './reveal';

export function LandingFinalCta() {
  const t = useTranslations('landing');

  return (
    <section className="py-20 sm:py-24">
      <div className="container">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center shadow-xl shadow-primary/20 sm:px-16">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute -left-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-24 -right-10 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
            </div>
            <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-5">
              <h2 className="text-balance text-3xl font-extrabold tracking-tight text-primary-foreground sm:text-4xl">
                {t('finalCta.title')}
              </h2>
              <p className="text-pretty text-lg text-primary-foreground/90">{t('finalCta.subtitle')}</p>
              <AuthCta
                anonymousLabel={t('finalCta.button')}
                size="lg"
                variant="secondary"
                className="mt-2 text-base"
              />
              <p className="text-sm text-primary-foreground/80">{t('finalCta.note')}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
