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
    <section id="why" className="scroll-mt-20 border-t border-border bg-card/40 py-20 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.why')}
          title={t('benefits.title')}
          subtitle={t('benefits.subtitle')}
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b, i) => {
            const Icon = b.icon;
            return (
              <Reveal key={b.key} delay={(i % 4) * 70}>
                <div className="flex h-full flex-col rounded-2xl border border-border bg-background p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-foreground">
                    {t(`benefits.items.${b.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`benefits.items.${b.key}.desc`)}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
