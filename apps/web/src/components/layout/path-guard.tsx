'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { usePathname, useRouter } from '@/i18n/routing';
import { canAccessAppPath } from '@/lib/nav-access';
import { homePath } from '@/lib/home-path';

/**
 * Soft lock for scoped desks (lab / UZI): if someone pastes /patients or
 * /admissions into the address bar, bounce them home instead of rendering the
 * roster. AuthGate already requires a session; this only narrows which app
 * screens that session may open.
 */
export function PathGuard({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    if (canAccessAppPath(pathname, user)) return;
    router.replace(homePath(user));
  }, [status, user, pathname, router]);

  if (status === 'authenticated' && user && !canAccessAppPath(pathname, user)) {
    return null;
  }

  return <>{children}</>;
}
