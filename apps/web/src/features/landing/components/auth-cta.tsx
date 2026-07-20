'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { Button, type ButtonProps } from '@/components/ui/button';

interface AuthCtaProps {
  /** Label shown to anonymous (or not-yet-restored) visitors. */
  anonymousLabel: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
  showArrow?: boolean;
}

/**
 * Primary call-to-action. Reads the auth store CLIENT-side: authenticated
 * visitors are sent to the dashboard, everyone else to the login page. The page
 * itself is never gated — this only swaps the button label and target.
 */
export function AuthCta({
  anonymousLabel,
  size,
  variant,
  className,
  showArrow = true,
}: AuthCtaProps) {
  const t = useTranslations('landing');
  const authenticated = useAuthStore((s) => s.status === 'authenticated');

  return (
    <Button asChild size={size} variant={variant} className={className}>
      <Link href={authenticated ? '/dashboard' : '/login'}>
        {authenticated ? t('cta.dashboard') : anonymousLabel}
        {showArrow ? <ArrowRight className="h-4 w-4" /> : null}
      </Link>
    </Button>
  );
}
