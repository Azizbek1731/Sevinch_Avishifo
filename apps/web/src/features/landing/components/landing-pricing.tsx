'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';
import { AuthCta } from './auth-cta';

interface Tier {
  key: 'starter' | 'standard' | 'pro';
  /** Monthly price, pre-formatted with thin thousands separators (matches seed). */
  price: string;
  popular: boolean;
}

const TIERS: readonly Tier[] = [
  { key: 'starter', price: '990 000', popular: false },
  { key: 'standard', price: '1 990 000', popular: true },
  { key: 'pro', price: '3 990 000', popular: false },
];

export function LandingPricing() {
  const t = useTranslations('landing');

  return (
    <section id="pricing" className="scroll-mt-20 border-t border-border py-20 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.pricing')}
          title={t('pricing.title')}
          subtitle={t('pricing.subtitle')}
        />

        <div className="mx-auto mt-14 grid max-w-5xl items-stretch gap-6 lg:grid-cols-3">
          {TIERS.map((tier, i) => {
            const raw = t.raw(`pricing.tiers.${tier.key}.features`);
            const features: string[] = Array.isArray(raw) ? raw.map(String) : [];
            return (
              <Reveal key={tier.key} delay={i * 80}>
                <div
                  className={cn(
                    'relative flex h-full flex-col rounded-2xl border p-6 transition-all duration-300 sm:p-8',
                    tier.popular
                      ? 'border-primary bg-primary/[0.04] shadow-lg shadow-primary/10 lg:-translate-y-2'
                      : 'border-border bg-card/40 hover:-translate-y-1 hover:border-primary/40',
                  )}
                >
                  {tier.popular ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/30">
                      {t('pricing.popular')}
                    </span>
                  ) : null}

                  <h3 className="text-lg font-bold text-foreground">
                    {t(`pricing.tiers.${tier.key}.name`)}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`pricing.tiers.${tier.key}.tagline`)}
                  </p>

                  <div className="mt-5 flex items-baseline gap-1.5">
                    <span className="text-4xl font-black tabular-nums text-foreground">
                      {tier.price}
                    </span>
                    <span className="text-muted-foreground">{t('pricing.som')}</span>
                    <span className="text-sm text-muted-foreground">/ {t('pricing.perMonth')}</span>
                  </div>

                  <ul className="mt-6 space-y-3 text-sm">
                    {features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="text-foreground/90">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-8">
                    <AuthCta
                      anonymousLabel={t('pricing.cta')}
                      variant={tier.popular ? 'default' : 'outline'}
                      className="w-full"
                      showArrow={false}
                    />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-muted-foreground">{t('pricing.note')}</p>
      </div>
    </section>
  );
}
