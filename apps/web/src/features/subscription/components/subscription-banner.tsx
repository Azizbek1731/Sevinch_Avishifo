'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock, MessageCircle, Phone } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { formatTz } from '@/lib/dates';

/** Show the countdown only once the trial is close enough to matter. */
const REMIND_FROM_DAYS = 5;

/**
 * Trial countdown / read-only notice, rendered above every panel page.
 *
 * An expired clinic keeps full read access — only writes are refused (see the
 * API's SubscriptionGuard) — so this is a persistent banner rather than a
 * full-screen block: the clinic must still be able to look up its own patients.
 */
export function SubscriptionBanner() {
  const t = useTranslations('subscription');
  const subscription = useAuthStore((s) => s.subscription);
  const support = useAuthStore((s) => s.support);

  if (!subscription || subscription.status === null) return null;

  const contactHref = support.telegram
    ? `https://t.me/${support.telegram}`
    : support.phone
      ? `tel:${support.phone}`
      : null;
  const ContactIcon = support.telegram ? MessageCircle : Phone;

  const contactButton = contactHref ? (
    <Button asChild size="sm" variant="secondary" className="shrink-0">
      <a href={contactHref} target="_blank" rel="noopener noreferrer">
        <ContactIcon className="mr-1.5 h-4 w-4" />
        {t('contact')}
      </a>
    </Button>
  ) : null;

  if (subscription.isExpired) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 md:px-6"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-semibold text-destructive">
              {subscription.isTrial ? t('expired.trialTitle') : t('expired.planTitle')}
            </p>
            <p className="text-muted-foreground">
              {t('expired.description')}
              {support.phone ? ` · ${support.phone}` : ''}
            </p>
          </div>
        </div>
        {contactButton}
      </div>
    );
  }

  const { daysLeft } = subscription;
  if (!subscription.isTrial || daysLeft === null || daysLeft > REMIND_FROM_DAYS) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2.5 md:px-6"
    >
      <div className="flex items-start gap-2.5">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground dark:text-warning" />
        <div className="text-sm">
          <p className="font-semibold">{t('trial.title', { days: daysLeft })}</p>
          <p className="text-muted-foreground">
            {subscription.endsAt
              ? t('trial.endsAt', { date: formatTz(subscription.endsAt, 'dd.MM.yyyy') })
              : t('trial.description')}
          </p>
        </div>
      </div>
      {contactButton}
    </div>
  );
}
