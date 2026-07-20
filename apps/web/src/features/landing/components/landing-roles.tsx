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
    <section className="py-20 sm:py-28">
      <div className="container">
        <SectionHeading title={t('roles.title')} subtitle={t('roles.subtitle')} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map((r, i) => {
            const Icon = r.icon;
            return (
              <Reveal key={r.key} delay={(i % 5) * 60}>
                <div className="flex h-full flex-col items-center rounded-2xl border border-border bg-card p-6 text-center transition-colors hover:border-primary/40">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                    <Icon className="h-7 w-7" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">
                    {t(`roles.items.${r.key}.title`)}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t(`roles.items.${r.key}.desc`)}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
