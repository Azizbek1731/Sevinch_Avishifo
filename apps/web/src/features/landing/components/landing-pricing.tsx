'use client';

import { useTranslations } from 'next-intl';
import { Ban, Banknote, CalendarCheck, Check, FileSpreadsheet, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';
import { AuthCta } from './auth-cta';

/** The one contact channel the product actually has, as used elsewhere in the app. */
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? 'AviShifoBot';

interface Tier {
  key: 'free' | 'start' | 'pro';
  /** Headline price, pre-formatted with thin thousands separators. */
  price: string;
  /** Unit under the price: the free tier is quoted weekly, the paid ones monthly. */
  unit: 'perWeek' | 'perMonth';
  /** Shown as the alternative when the headline price assumes a yearly commitment. */
  monthlyPrice?: string;
  popular: boolean;
}

const TIERS: readonly Tier[] = [
  { key: 'free', price: '0', unit: 'perWeek', popular: false },
  { key: 'start', price: '199 000', unit: 'perMonth', monthlyPrice: '249 000', popular: true },
  { key: 'pro', price: '349 000', unit: 'perMonth', monthlyPrice: '399 000', popular: false },
];

const GUARANTEE_ICONS: readonly LucideIcon[] = [CalendarCheck, FileSpreadsheet, Ban, Banknote];

export function LandingPricing() {
  const t = useTranslations('landing');
  const guarantees = (t.raw('pricing.guarantees') as string[] | undefined) ?? [];

  return (
    <section id="pricing" className="scroll-mt-20 border-t border-border py-14 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.pricing')}
          title={t('pricing.title')}
          subtitle={t('pricing.subtitle')}
        />

        <div className="mx-auto mt-10 grid max-w-5xl items-stretch gap-5 sm:mt-14 sm:gap-6 lg:grid-cols-3">
          {TIERS.map((tier, i) => {
            const raw = t.raw(`pricing.tiers.${tier.key}.features`);
            const features: string[] = Array.isArray(raw) ? raw.map(String) : [];
            return (
              <Reveal key={tier.key} delay={i * 80}>
                <div
                  className={cn(
                    'relative flex h-full flex-col rounded-2xl border p-5 transition-all duration-300 sm:p-8',
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

                  {/* The price has to stay on one line down to 320px, where the
                      six-digit tiers plus the unit no longer fit at 4xl. */}
                  <div className="mt-4 flex flex-wrap items-baseline gap-x-1.5 sm:mt-5">
                    <span className="text-3xl font-black tabular-nums text-foreground sm:text-4xl">
                      {tier.price}
                    </span>
                    <span className="text-muted-foreground">{t('pricing.som')}</span>
                    <span className="text-sm text-muted-foreground">
                      / {t(`pricing.${tier.unit}`)}
                    </span>
                  </div>

                  {/* Two prices on one card is the usual way to mis-sell a plan,
                      so the commitment the headline assumes is stated on the
                      line beneath it rather than in a footnote. */}
                  <p className="mt-1 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
                    {tier.monthlyPrice ? (
                      <>
                        {t('pricing.yearly')}
                        <br />
                        {t('pricing.monthlyAlt', { price: tier.monthlyPrice })}
                      </>
                    ) : null}
                  </p>

                  <ul className="mt-4 space-y-2.5 text-sm sm:mt-5 sm:space-y-3">
                    {features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="text-foreground/90">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-6 sm:pt-8">
                    <AuthCta
                      anonymousLabel={t(`pricing.tiers.${tier.key}.cta`)}
                      variant={tier.popular ? 'default' : 'outline'}
                      className="h-11 w-full sm:h-9"
                      showArrow={false}
                    />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground sm:mt-10">
          {t('pricing.network')}{' '}
          <a
            href={`https://t.me/${BOT_USERNAME}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('pricing.networkCta')}
          </a>
        </p>

        {/* Wraps to two columns on a phone rather than shrinking the text. */}
        <ul className="mx-auto mt-6 grid max-w-4xl grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center lg:justify-center lg:gap-x-6">
          {guarantees.map((g, i) => {
            const Icon = GUARANTEE_ICONS[i] ?? Check;
            return (
              <li key={i} className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <span>{g}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
