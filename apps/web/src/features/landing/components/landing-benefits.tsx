'use client';

import { useTranslations } from 'next-intl';
import { Globe2, MapPin, ShieldCheck, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const BENEFITS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: 'security', icon: ShieldCheck },
  { key: 'local', icon: MapPin },
  { key: 'fast', icon: Zap },
  { key: 'multilang', icon: Globe2 },
];

export function LandingBenefits() {
  const t = useTranslations('landing');

  return (
    <section id="why" className="scroll-mt-20 border-t border-border bg-card/40 py-14 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.why')}
          title={t('benefits.title')}
          subtitle={t('benefits.subtitle')}
        />
        <div className="mt-8 grid gap-4 sm:mt-14 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b, i) => {
            const Icon = b.icon;
            return (
              <Reveal key={b.key} delay={(i % 4) * 70}>
                <div className="flex h-full items-start gap-4 rounded-2xl border border-border bg-background p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5 sm:block sm:p-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30 sm:h-12 sm:w-12">
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground sm:mt-4">
                      {t(`benefits.items.${b.key}.title`)}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:mt-2">
                      {t(`benefits.items.${b.key}.desc`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
