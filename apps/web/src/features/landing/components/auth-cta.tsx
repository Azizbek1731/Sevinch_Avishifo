'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { Button, type ButtonProps } from '@/components/ui/button';
import { usePanelUrl, type PanelPath } from './panel-link';

interface AuthCtaProps {
  /** Label shown to anonymous (or not-yet-restored) visitors. */
  anonymousLabel: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
  showArrow?: boolean;
  /** Where an anonymous visitor goes: the free-trial sign-up or the login page. */
  target?: PanelPath;
}

/**
 * Primary clinic call-to-action. Anonymous visitors are sent to the panel host —
 * the landing lives on the apex, where sign-up and login do not exist. A session
 * can only exist on the origin that issued it, so the "go to dashboard" variant
 * stays an in-app link.
 */
export function AuthCta({
  anonymousLabel,
  size,
  variant,
  className,
  showArrow = true,
  target = 'register',
}: AuthCtaProps) {
  const t = useTranslations('landing');
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  const panelUrl = usePanelUrl(target);

  const label = authenticated ? t('cta.dashboard') : anonymousLabel;
  const arrow = showArrow ? <ArrowRight className="h-4 w-4" /> : null;

  if (!authenticated && panelUrl) {
    return (
      <Button asChild size={size} variant={variant} className={className}>
        <a href={panelUrl}>
          {label}
          {arrow}
        </a>
      </Button>
    );
  }

  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={authenticated ? '/dashboard' : `/${target}`}>
        {label}
        {arrow}
      </Link>
    </Button>
  );
}
