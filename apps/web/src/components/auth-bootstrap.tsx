'use client';

import { useEffect, type ReactNode } from 'react';
import { ApiError, api, apiFetch } from '@/lib/api-client';
import { useAuthStore, type MeResponse } from '@/stores/auth-store';

/**
 * Module-level guard: the session is bootstrapped ONCE per full page load, not
 * per component mount. A locale switch remounts the [locale] layout (and this
 * component) via client-side navigation without reloading the module, so the
 * in-memory session persists and we must NOT re-run /auth/refresh — doing so on
 * every locale change is what logged users out.
 */
let bootstrapped = false;

/**
 * Retried while the server cannot answer: a page opened during a Wi-Fi drop or
 * while the clinic server restarts still has a valid refresh cookie. A plain
 * 500 is given a few tries so a broken server still ends on the login form.
 */
function shouldRetry(error: unknown, attempt: number): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504)
    return true;
  return error.status >= 500 && attempt < 5;
}

/**
 * On first page load: refresh-cookie → access token → /auth/me restores the
 * session. Rejection leaves status='anonymous' (AuthGate redirects to login).
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
      for (let attempt = 1; ; attempt += 1) {
        try {
          // anonymous: a refused cookie must not trigger a second refresh with it.
          const refresh = await apiFetch<{ accessToken: string }>('/auth/refresh', {
            method: 'POST',
            body: {},
            anonymous: true,
          });
          store.setAccessToken(refresh.data.accessToken);
          const me = await api.get<MeResponse>('/auth/me');
          store.setSession({ ...me.data, accessToken: refresh.data.accessToken });
          return;
        } catch (error) {
          if (!shouldRetry(error, attempt)) {
            store.clear();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 10_000)));
        }
      }
    })();
  }, []);

  return <>{children}</>;
}
