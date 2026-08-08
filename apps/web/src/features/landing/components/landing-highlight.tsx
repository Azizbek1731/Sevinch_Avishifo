'use client';

import { useTranslations } from 'next-intl';
import { MonitorPlay, RefreshCw, Repeat, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const POINTS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: 'zeroRefresh', icon: RefreshCw },
  { key: 'tv', icon: MonitorPlay },
  { key: 'voice', icon: Volume2 },
  { key: 'priority', icon: Repeat },
];

const NEXT_TICKETS: ReadonlyArray<string> = ['A-014', 'A-015', 'B-008'];

/** Flagship live-queue + TV-display highlight: copy + a simulated waiting-room screen. */
export function LandingHighlight() {
  const t = useTranslations('landing');

  return (
    <section id="queue" className="scroll-mt-20 border-y border-border bg-accent/30 py-14 sm:py-28">
      <div className="container grid items-center gap-8 sm:gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal className="order-2 lg:order-1">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-2xl sm:p-8">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.28),transparent_60%)]"
            />
            <div className="relative">
              <div className="flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-2 text-xs font-semibold tracking-widest">
                  <MonitorPlay className="h-4 w-4" />
                  {t('highlight.preview.screen')}
                </span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
                  LIVE
                </span>
              </div>

              <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-slate-400 sm:mt-6">
                {t('highlight.preview.nowServing')}
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-3 sm:gap-4">
                <span className="text-5xl font-black leading-none text-primary sm:text-7xl">A-013</span>
                <span className="mb-1 rounded-lg bg-primary/20 px-3 py-1 text-base font-bold text-primary sm:mb-1.5 sm:text-lg">
                  {t('hero.preview.room', { n: 5 })}
                </span>
              </div>

              <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-slate-400 sm:mt-6">
                {t('highlight.preview.next')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {NEXT_TICKETS.map((tk) => (
                  <span
                    key={tk}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-200"
                  >
                    {tk}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 sm:mt-6">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                  <Volume2 className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium text-slate-100">{t('highlight.preview.announce')}</p>
              </div>
            </div>
          </div>
        </Reveal>

        <div className="order-1 lg:order-2">
          <SectionHeading
            align="left"
            eyebrow={t('highlight.badge')}
            title={t('highlight.title')}
            subtitle={t('highlight.subtitle')}
          />
          <div className="mt-6 space-y-4 sm:mt-8 sm:space-y-5">
            {POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.key} className="flex gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">
                      {t(`highlight.points.${p.key}.title`)}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`highlight.points.${p.key}.desc`)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
