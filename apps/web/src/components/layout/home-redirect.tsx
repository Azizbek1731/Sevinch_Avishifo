'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { homePath } from '@/lib/home-path';
import { useAuthStore } from '@/stores/auth-store';

/** Keep saved links to removed sections usable without reopening those screens. */
export function HomeRedirect() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace(homePath(user));
  }, [user, router]);

  return null;
}
