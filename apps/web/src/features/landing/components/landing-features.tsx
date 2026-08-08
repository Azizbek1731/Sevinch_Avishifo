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
    <section id="features" className="scroll-mt-20 py-14 sm:py-28">
      <div className="container">
        <SectionHeading
          eyebrow={t('nav.features')}
          title={t('features.title')}
          subtitle={t('features.subtitle')}
        />
        {/* Eight stacked cards is a long scroll on a phone, so the icon moves
            beside the copy below `sm` instead of sitting on its own row. */}
        <div className="mt-8 grid gap-4 sm:mt-14 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.key} delay={(i % 4) * 70}>
                <div className="group flex h-full items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 sm:block sm:p-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground sm:h-12 sm:w-12">
                    <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground sm:mt-4">
                      {t(`features.items.${f.key}.title`)}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:mt-2">
                      {t(`features.items.${f.key}.desc`)}
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
