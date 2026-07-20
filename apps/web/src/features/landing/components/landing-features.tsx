'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  CalendarClock,
  FlaskConical,
  MonitorPlay,
  Receipt,
  Send,
  Smartphone,
  Stethoscope,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const FEATURES: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: 'queue', icon: MonitorPlay },
  { key: 'ehr', icon: Stethoscope },
  { key: 'appointments', icon: CalendarClock },
  { key: 'cashier', icon: Receipt },
  { key: 'lab', icon: FlaskConical },
  { key: 'notifications', icon: Send },
  { key: 'analytics', icon: BarChart3 },
  { key: 'portal', icon: Smartphone },
];

export function LandingFeatures() {
  const t = useTranslations('landing');

  return (
    <section id="features" className="scroll-mt-20 py-20 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.features')}
          title={t('features.title')}
          subtitle={t('features.subtitle')}
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.key} delay={(i % 4) * 70}>
                <div className="group h-full rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-6 w-6" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-foreground">
                    {t(`features.items.${f.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`features.items.${f.key}.desc`)}
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
