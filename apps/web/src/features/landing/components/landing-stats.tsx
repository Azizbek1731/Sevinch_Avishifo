'use client';

import { useTranslations } from 'next-intl';

const STATS: ReadonlyArray<string> = ['modules', 'languages', 'realtime', 'uptime'];

export function LandingStats() {
  const t = useTranslations('landing');

  return (
    <section className="border-y border-border bg-card/40">
      <div className="container grid grid-cols-2 gap-6 py-10 sm:py-12 lg:grid-cols-4">
        {STATS.map((k) => (
          <div key={k} className="flex flex-col items-center text-center">
            <span className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">
              {t(`stats.${k}.value`)}
            </span>
            <span className="mt-1 text-sm text-muted-foreground">{t(`stats.${k}.label`)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
