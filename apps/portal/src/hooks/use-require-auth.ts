'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, type SessionStatus } from '@/stores/session';

/** Redirects guests to /login (with ?next= back-link). Returns the session status. */
export function useRequireAuth(): SessionStatus {
  const status = useSession((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'guest') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, router]);

  return status;
}
