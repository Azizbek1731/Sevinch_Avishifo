'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const NOW_SERVING: ReadonlyArray<{
  ticket: string;
  name: string;
  doctor: 'doctorCardio' | 'doctorTherapist';
  room: number;
  active: boolean;
}> = [
  { ticket: 'A-013', name: 'A. Karimov', doctor: 'doctorCardio', room: 5, active: true },
  { ticket: 'B-007', name: 'M. Yusupova', doctor: 'doctorTherapist', room: 2, active: false },
];

const WAITING: ReadonlyArray<{ ticket: string; name: string; wait: number }> = [
  { ticket: 'A-014', name: 'S. Rahimova', wait: 6 },
  { ticket: 'A-015', name: 'D. Aliyev', wait: 12 },
  { ticket: 'B-008', name: 'N. Tosheva', wait: 18 },
];

/** Self-contained live-queue board mock for the hero (divs only, no image). */
export function QueuePreview() {
  const t = useTranslations('landing');

  return (
    <div className="relative">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-2xl shadow-primary/10 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('hero.preview.title')}</p>
            <p className="text-xs text-muted-foreground">{t('hero.preview.branch')}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            {t('hero.preview.live')}
          </span>
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:mt-5">
          {t('hero.preview.nowServing')}
        </p>
        <div className="mt-2 space-y-2">
          {NOW_SERVING.map((r) => (
            <div
              key={r.ticket}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                r.active ? 'border-primary/40 bg-primary/5' : 'border-border bg-background',
              )}
            >
              <span
                className={cn(
                  'flex h-11 w-14 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                  r.active ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground',
                )}
              >
                {r.ticket}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">{t(`hero.preview.${r.doctor}`)}</p>
              </div>
              <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                {t('hero.preview.room', { n: r.room })}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('hero.preview.waiting')}
        </p>
        <div className="mt-2 space-y-1">
          {WAITING.map((r) => (
            <div key={r.ticket} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold text-muted-foreground">
                {r.ticket}
              </span>
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</p>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {r.wait} {t('hero.preview.minutes')}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:mt-5">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-2xl font-bold text-foreground">12</p>
            <p className="text-xs text-muted-foreground">{t('hero.preview.statWaiting')}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-2xl font-bold text-foreground">
              8 <span className="text-sm font-medium text-muted-foreground">{t('hero.preview.minutes')}</span>
            </p>
            <p className="text-xs text-muted-foreground">{t('hero.preview.statAvgWait')}</p>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-5 -left-4 hidden items-center gap-2.5 rounded-xl border border-border bg-card p-3 pr-4 shadow-xl sm:flex">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/15 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{t('hero.preview.toast')}</p>
          <p className="text-xs text-muted-foreground">Payme &middot; 150 000</p>
        </div>
      </div>
    </div>
  );
}
