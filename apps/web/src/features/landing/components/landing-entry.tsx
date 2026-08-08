'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CalendarCheck,
  FileText,
  FlaskConical,
  Send,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { portalBaseUrlFallback, resolvePortalBaseUrl } from '@/lib/portal-url';
import { SectionHeading } from './section-heading';
import { Reveal } from './reveal';

const POINTS: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: FlaskConical, key: 'labs' },
  { icon: CalendarCheck, key: 'appointments' },
  { icon: FileText, key: 'documents' },
  { icon: Stethoscope, key: 'history' },
];

/**
 * The patient door. Everything above this band sells the CRM to a clinic, but a
 * patient looking up a lab result arrives on the same page and has no account in
 * the staff panel — they belong on the portal host, which is a different origin.
 */
export function LandingPatientEntry() {
  const t = useTranslations('landing');
  // The portal host is derived from window.location, so the real value only
  // exists after mount. Start from the build-time fallback so the server renders
  // a working link rather than a placeholder — these are the primary buttons for
  // every patient who lands here, and a dead first paint loses them.
  const [portal, setPortal] = useState(portalBaseUrlFallback);
  useEffect(() => setPortal(resolvePortalBaseUrl()), []);

  return (
    <section
      id="patient"
      className="scroll-mt-20 border-y border-emerald-500/20 bg-emerald-500/[0.05] py-14 sm:py-24"
    >
      <div className="container">
        <SectionHeading
          eyebrow={
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              {t('patient.eyebrow')}
            </span>
          }
          title={t('patient.title')}
          subtitle={t('patient.subtitle')}
        />

        <div className="mx-auto mt-8 grid max-w-5xl gap-4 sm:mt-12 sm:gap-5 sm:grid-cols-2">
          {POINTS.map(({ icon: Icon, key }, i) => (
            <Reveal key={key} delay={i * 70}>
              <div className="flex h-full items-start gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold text-foreground">{t(`patient.points.${key}.title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t(`patient.points.${key}.desc`)}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={140}>
          <div className="mx-auto mt-6 flex max-w-5xl flex-col items-center gap-5 rounded-2xl border border-emerald-500/25 bg-card p-5 text-center shadow-sm sm:mt-8 sm:p-8">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <Send className="h-4 w-4" />
              {t('patient.telegram')}
            </p>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 bg-emerald-600 px-6 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 sm:px-8"
              >
                <a href={portal ? `${portal}/login` : '#patient'}>
                  {t('patient.login')}
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base sm:px-8">
                <a href={portal ? `${portal}/register` : '#patient'}>{t('patient.register')}</a>
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">{t('patient.hint')}</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
