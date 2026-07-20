'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, MessageSquare, Radio, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthCta } from './auth-cta';
import { QueuePreview } from './queue-preview';

const TRUST: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: Building2, key: 'hero.trust.multiBranch' },
  { icon: Radio, key: 'hero.trust.realtime' },
  { icon: MessageSquare, key: 'hero.trust.messaging' },
  { icon: Wallet, key: 'hero.trust.payments' },
];

export function LandingHero() {
  const t = useTranslations('landing');

  return (
    <section id="top" className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-12%] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.18),transparent_60%)] blur-2xl" />
        <div className="absolute right-[-8%] top-[18%] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.12),transparent_65%)] blur-2xl" />
      </div>

      <div className="container grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:gap-10 lg:py-28">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {t('hero.badge')}
          </span>

          <h1 className="text-balance text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {t.rich('hero.title', {
              hl: (chunks) => <span className="text-primary">{chunks}</span>,
            })}
          </h1>

          <p className="max-w-xl text-pretty text-lg text-muted-foreground">{t('hero.subtitle')}</p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <AuthCta anonymousLabel={t('hero.ctaPrimary')} size="lg" className="text-base" />
            <Button asChild variant="outline" size="lg" className="text-base">
              <a href="#features">
                {t('hero.ctaSecondary')}
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {TRUST.map(({ icon: Icon, key }) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground"
              >
                <Icon className="h-3.5 w-3.5 text-primary" />
                {t(key)}
              </span>
            ))}
          </div>
        </div>

        <div className="relative lg:pl-4">
          <QueuePreview />
        </div>
      </div>
    </section>
  );
}
