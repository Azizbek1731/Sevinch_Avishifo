'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { homePath } from '@/lib/home-path';
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
  /** Lets an overlay close itself before the browser leaves the page. */
  onClick?: () => void;
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
  onClick,
}: AuthCtaProps) {
  const t = useTranslations('landing');
  // The user, not just the flag: "go to the panel" has to point at the screen
  // this role may open — /dashboard is an owner's home, not a receptionist's.
  const user = useAuthStore((s) => (s.status === 'authenticated' ? s.user : null));
  const authenticated = user !== null;
  const panelUrl = usePanelUrl(target);

  const label = authenticated ? t('cta.dashboard') : anonymousLabel;
  const arrow = showArrow ? <ArrowRight className="h-4 w-4" /> : null;

  if (!authenticated && panelUrl) {
    return (
      <Button asChild size={size} variant={variant} className={className}>
        <a href={panelUrl} onClick={onClick}>
          {label}
          {arrow}
        </a>
      </Button>
    );
  }

  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={user ? homePath(user) : `/${target}`} onClick={onClick}>
        {label}
        {arrow}
      </Link>
    </Button>
  );
}
