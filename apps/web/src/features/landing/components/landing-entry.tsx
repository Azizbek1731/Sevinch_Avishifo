'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, FlaskConical, HeartPulse, ShieldCheck, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { resolvePortalBaseUrl } from '@/lib/portal-url';
import { useAuthStore } from '@/stores/auth-store';
import { SectionHeading } from './section-heading';
import { Reveal } from './reveal';

const CLINIC_POINTS: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: Building2, key: 'entry.clinic.points.branches' },
  { icon: HeartPulse, key: 'entry.clinic.points.queue' },
  { icon: ShieldCheck, key: 'entry.clinic.points.trial' },
];

const PATIENT_POINTS: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: FlaskConical, key: 'entry.patient.points.labs' },
  { icon: UserRound, key: 'entry.patient.points.history' },
  { icon: ShieldCheck, key: 'entry.patient.points.telegram' },
];

/**
 * The two front doors. Clinics and patients arrive on the same landing page but
 * want opposite things — one is buying software, the other is looking up a lab
 * result — and a single "Sign in" button sent both to the staff panel, where a
 * patient has no account and no way to make one.
 */
export function LandingEntry() {
  const t = useTranslations('landing');
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  // The portal host is derived from window.location, so it can only be resolved
  // after mount; until then the buttons point at the portal root path.
  const [portal, setPortal] = useState('');
  useEffect(() => setPortal(resolvePortalBaseUrl()), []);

  return (
    <section id="entry" className="border-t border-border/60 bg-muted/30 py-16 sm:py-20">
      <div className="container">
        <SectionHeading eyebrow={t('entry.eyebrow')} title={t('entry.title')} subtitle={t('entry.subtitle')} />

        <div className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-2">
          {/* Clinic */}
          <Reveal>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md sm:p-7">
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Building2 className="h-3.5 w-3.5" />
                {t('entry.clinic.badge')}
              </span>
              <h3 className="mt-4 text-xl font-bold text-foreground">{t('entry.clinic.title')}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t('entry.clinic.description')}</p>

              <ul className="mt-5 flex flex-col gap-2.5">
                {CLINIC_POINTS.map(({ icon: Icon, key }) => (
                  <li key={key} className="flex items-start gap-2.5 text-sm text-foreground/80">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {t(key)}
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col gap-2 pt-6 sm:flex-row">
                <Button asChild className="sm:flex-1">
                  <Link href={authenticated ? '/dashboard' : '/register'}>
                    {authenticated ? t('cta.dashboard') : t('entry.clinic.register')}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {authenticated ? null : (
                  <Button asChild variant="outline" className="sm:flex-1">
                    <Link href="/login">{t('entry.clinic.login')}</Link>
                  </Button>
                )}
              </div>
            </div>
          </Reveal>

          {/* Patient */}
          <Reveal delay={80}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md sm:p-7">
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <UserRound className="h-3.5 w-3.5" />
                {t('entry.patient.badge')}
              </span>
              <h3 className="mt-4 text-xl font-bold text-foreground">{t('entry.patient.title')}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t('entry.patient.description')}</p>

              <ul className="mt-5 flex flex-col gap-2.5">
                {PATIENT_POINTS.map(({ icon: Icon, key }) => (
                  <li key={key} className="flex items-start gap-2.5 text-sm text-foreground/80">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    {t(key)}
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col gap-2 pt-6 sm:flex-row">
                <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-1">
                  <a href={`${portal}/login`}>
                    {t('entry.patient.login')}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline" className="sm:flex-1">
                  <a href={`${portal}/register`}>{t('entry.patient.register')}</a>
                </Button>
              </div>
              <p className="pt-3 text-xs text-muted-foreground">{t('entry.patient.hint')}</p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
