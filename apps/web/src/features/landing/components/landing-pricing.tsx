'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Ban,
  Banknote,
  CalendarCheck,
  Check,
  FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';
import { AuthCta } from './auth-cta';

/** The one contact channel the product actually has, as used elsewhere in the app. */
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? 'AviShifoBot';

type Cycle = 'yearly' | 'monthly';

interface Tier {
  key: 'start' | 'standard' | 'pro';
  yearly: number;
  monthly: number;
  popular: boolean;
}

/**
 * Every price on this page, in one place. The headline, the comparison strip
 * and the cards all read from here, so no edit can leave one of them quoting a
 * figure the others have moved on from.
 */
const TIERS: readonly Tier[] = [
  { key: 'start', yearly: 390_000, monthly: 490_000, popular: false },
  { key: 'standard', yearly: 790_000, monthly: 990_000, popular: true },
  { key: 'pro', yearly: 2_390_000, monthly: 2_990_000, popular: false },
];

const START = TIERS[0]!;

/**
 * The annual discount, but only when it is the same on every tier.
 *
 * Stated as a percentage rather than an amount: the tiers are now an order of
 * magnitude apart, so a flat som figure would read as generous on START and
 * trivial on PRO. Floored, never rounded, so the badge cannot claim a point
 * more than the smallest actual discount. If a future re-price makes them
 * diverge this returns null and both the badge and the shared sentence stop
 * rendering rather than becoming false on two cards out of three.
 */
const PCTS = TIERS.map((t) => Math.floor(((t.monthly - t.yearly) / t.monthly) * 100));
const PCT = PCTS.every((p) => p === PCTS[0]) ? PCTS[0]! : null;

/** Thousands separated by a space, the way every price on this page is written. */
function som(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const GUARANTEE_ICONS: readonly LucideIcon[] = [CalendarCheck, FileSpreadsheet, Ban, Banknote];

export function LandingPricing() {
  const t = useTranslations('landing');
  // A literal default, so the server HTML and the first client render are
  // identical and the page is still statically renderable.
  const [cycle, setCycle] = useState<Cycle>('yearly');
  const uid = useId();

  const guarantees = (t.raw('pricing.guarantees') as string[] | undefined) ?? [];
  const cycleNote = cycle === 'yearly' ? t('pricing.billedYearly') : t('pricing.billedMonthly');

  return (
    <section id="pricing" className="scroll-mt-20 border-t border-border py-14 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.pricing')}
          title={t('pricing.title', { from: som(START.yearly) })}
          subtitle={t('pricing.subtitle')}
        />

        {/*
          Two named, mutually exclusive options is a radio group, so it is built
          from real radios: one tab stop, arrow keys move and select, and the
          screen reader says "1 of 2, selected" without a line of keyboard code.
          A switch would announce "off" without ever naming what off costs.
        */}
        <fieldset className="mt-8">
          <legend className="sr-only">{t('pricing.billing.legend')}</legend>
          {/* w-fit, not w-auto: the pill is a block-level flex box, and w-auto
              on a block fills the row — which left the two options packed
              against the left edge of a full-width track. Shrinking to content
              is what lets mx-auto actually centre it. */}
          <div className="mx-auto flex w-full max-w-xs flex-col items-stretch rounded-xl border border-border bg-muted p-1 sm:w-fit sm:max-w-none sm:flex-row">
            {(['yearly', 'monthly'] as const).map((c) => (
              <label key={c} className="flex cursor-pointer sm:flex-none">
                <input
                  type="radio"
                  name={`${uid}-billing`}
                  value={c}
                  checked={cycle === c}
                  onChange={() => setCycle(c)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors motion-reduce:transition-none md:min-h-9',
                    'peer-checked:bg-background peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                  )}
                >
                  {t(`pricing.billing.${c}`)}
                  {c === 'yearly' && PCT !== null ? (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-primary">
                      {t('pricing.billing.save', { pct: String(PCT) })}
                    </span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {PCT !== null ? (
          <p className="mt-3 text-center text-sm text-muted-foreground">
            {t('pricing.billing.flat', { pct: String(PCT) })}
          </p>
        ) : null}

        {/* The same comparison as the headline, but as two prices side by side:
            a struck-out number next to ours is read in a glance, where a
            sentence about market rates has to be parsed. */}
        <div className="mx-auto mt-7 flex max-w-lg flex-col items-stretch gap-3 sm:mt-8 sm:flex-row sm:items-center sm:justify-center">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 px-4 py-3 sm:flex-col sm:items-start sm:gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('pricing.compare.others')}
            </span>
            <s className="text-lg font-bold tabular-nums text-muted-foreground">
              {som(START.monthly)}
            </s>
          </div>

          <ArrowRight className="mx-auto hidden h-5 w-5 shrink-0 text-muted-foreground sm:block" />

          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary bg-primary/[0.06] px-4 py-3 sm:flex-col sm:items-start sm:gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wider text-primary">
              {t('pricing.compare.ours')}
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-lg font-black tabular-nums text-foreground">
                {som(START.yearly)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('pricing.som')} / {t('pricing.perMonth')}
              </span>
            </span>
          </div>
        </div>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t('pricing.compare.oursNote')}
        </p>
        <p className="mt-1 text-center text-sm font-medium text-primary">
          {t('pricing.compare.save', { amount: som(START.monthly - START.yearly) })}
        </p>

        <div className="mx-auto mt-10 grid max-w-5xl items-stretch gap-5 sm:mt-12 sm:gap-6 lg:grid-cols-3">
          {TIERS.map((tier, i) => {
            const raw = t.raw(`pricing.tiers.${tier.key}.features`);
            const features: string[] = Array.isArray(raw) ? raw.map(String) : [];
            const price = tier[cycle];
            return (
              // Deliberately not keyed on `cycle`: Reveal latches its observer,
              // so re-keying would replay the entrance stagger on every toggle
              // and read as a page reload.
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

                  {/* In yearly mode the monthly price is struck through above:
                      a real alternative the visitor could pay today is what
                      persuades. In monthly mode the yearly price is offered
                      plainly rather than struck — striking it would frame
                      monthly as a penalty and imply the yearly rate is gone. */}
                  <p className="mt-4 min-h-[1.25rem] text-xs text-muted-foreground sm:mt-5">
                    {cycle === 'yearly' ? (
                      <s className="tabular-nums">
                        {t('pricing.monthlyStruck', { price: som(tier.monthly) })}
                      </s>
                    ) : (
                      <span className="tabular-nums text-primary">
                        {t('pricing.yearlyInvite', { price: som(tier.yearly) })}
                      </span>
                    )}
                  </p>

                  {/* Has to stay on one line down to 320px, where six digits
                      plus the unit no longer fit at 4xl. */}
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-3xl font-black tabular-nums text-foreground sm:text-4xl">
                      {som(price)}
                    </span>
                    <span className="text-muted-foreground">{t('pricing.som')}</span>
                    <span className="text-sm text-muted-foreground">/ {t('pricing.perMonth')}</span>
                  </div>
                  {/* Named on every card, so nobody has to scroll back to the
                      control to remember which prices they are looking at. */}
                  <p className="mt-1 text-xs text-muted-foreground">{cycleNote}</p>

                  <ul className="mt-5 space-y-2.5 text-sm sm:mt-6 sm:space-y-3">
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

        {/* The choice above is not carried into sign-up, so the page says so
            rather than letting the visitor assume it was saved. */}
        <p className="mt-6 text-center text-sm text-muted-foreground">{t('pricing.planLater')}</p>

        <p className="mt-3 text-center text-sm text-muted-foreground">
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
