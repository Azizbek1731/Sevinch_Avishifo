'use client';

import { useTranslations } from 'next-intl';
import { Briefcase, ClipboardList, FlaskConical, Stethoscope, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const ROLES: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: 'director', icon: Briefcase },
  { key: 'doctor', icon: Stethoscope },
  { key: 'reception', icon: ClipboardList },
  { key: 'cashier', icon: Wallet },
  { key: 'lab', icon: FlaskConical },
];

export function LandingRoles() {
  const t = useTranslations('landing');

  return (
    <section className="py-14 sm:py-28">
      <div className="container">
        <SectionHeading title={t('roles.title')} subtitle={t('roles.subtitle')} />
        <div className="mt-8 grid gap-4 sm:mt-14 sm:gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map((r, i) => {
            const Icon = r.icon;
            return (
              <Reveal key={r.key} delay={(i % 5) * 60}>
                <div className="flex h-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 sm:flex-col sm:items-center sm:p-6 sm:text-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary sm:h-14 sm:w-14">
                    <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground sm:mt-4">
                      {t(`roles.items.${r.key}.title`)}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`roles.items.${r.key}.desc`)}
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
