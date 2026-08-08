'use client';

import { useTranslations } from 'next-intl';
import { CalendarClock, Rocket, ShieldCheck, SlidersHorizontal, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AuthCta } from './auth-cta';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const STEPS: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: UserPlus, key: 'signup' },
  { icon: SlidersHorizontal, key: 'setup' },
  { icon: Rocket, key: 'launch' },
];

const ASSURANCES: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: CalendarClock, key: 'trial.assurances.fullAccess' },
  { icon: ShieldCheck, key: 'trial.assurances.ownData' },
];

/**
 * The free trial is the offer the hero leads with, so it gets its own band right
 * underneath: what the seven days actually contain and how a clinic starts them.
 */
export function LandingTrial() {
  const t = useTranslations('landing');

  return (
    <section id="trial" className="scroll-mt-20 border-t border-border/60 bg-muted/30 py-16 sm:py-20">
      <div className="container">
        <SectionHeading
          eyebrow={t('trial.eyebrow')}
          title={t('trial.title')}
          subtitle={t('trial.subtitle')}
        />

        <ol className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, key }, i) => (
            <Reveal key={key} delay={i * 80}>
              <li className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-bold tabular-nums text-primary/70">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-foreground">
                  {t(`trial.steps.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`trial.steps.${key}.desc`)}
                </p>
              </li>
            </Reveal>
          ))}
        </ol>

        <Reveal delay={160}>
          <div className="mx-auto mt-10 flex max-w-5xl flex-col items-center gap-6 rounded-2xl border border-primary/20 bg-primary/[0.05] p-6 sm:p-8 lg:flex-row lg:justify-between">
            <ul className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center lg:justify-start">
              {ASSURANCES.map(({ icon: Icon, key }) => (
                <li
                  key={key}
                  className="inline-flex items-center gap-2 text-sm font-medium text-foreground/80"
                >
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  {t(key)}
                </li>
              ))}
            </ul>
            <AuthCta
              anonymousLabel={t('trial.cta')}
              size="lg"
              className="h-12 w-full px-8 text-base font-semibold shadow-lg shadow-primary/20 sm:w-auto"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
