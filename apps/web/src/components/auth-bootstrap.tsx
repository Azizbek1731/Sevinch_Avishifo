'use client';

import { useEffect, type ReactNode } from 'react';
import type { AuthUser } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { useAuthStore, type BranchInfo, type ClinicInfo } from '@/stores/auth-store';

interface MeResponse {
  user: AuthUser;
  clinic: ClinicInfo | null;
  branches: BranchInfo[];
}

/**
 * Module-level guard: the session is bootstrapped ONCE per full page load, not
 * per component mount. A locale switch remounts the [locale] layout (and this
 * component) via client-side navigation without reloading the module, so the
 * in-memory session persists and we must NOT re-run /auth/refresh — doing so on
 * every locale change is what logged users out.
 */
let bootstrapped = false;

/**
 * On first page load: refresh-cookie → access token → /auth/me restores the
 * session. Failure leaves status='anonymous' (AuthGate redirects to login).
 * Skipped entirely once a session already exists in memory.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;

    const store = useAuthStore.getState();
    // Already signed in (e.g. right after login, or a same-session client nav):
    // nothing to restore, and re-refreshing would rotate tokens pointlessly.
    if (store.status === 'authenticated' && store.accessToken) return;

    void (async () => {
      try {
        const refresh = await api.post<{ accessToken: string }>('/auth/refresh', {});
        store.setAccessToken(refresh.data.accessToken);
        const me = await api.get<MeResponse>('/auth/me');
        store.setSession({ ...me.data, accessToken: refresh.data.accessToken });
      } catch {
        store.clear();
      }
    })();
  }, []);

  return <>{children}</>;
}
