'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { AuthUser } from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { useAuthStore, type BranchInfo, type ClinicInfo } from '@/stores/auth-store';

interface MeResponse {
  user: AuthUser;
  clinic: ClinicInfo | null;
  branches: BranchInfo[];
}

/**
 * On first mount: try refresh-cookie → access token → /auth/me.
 * Failure leaves status='anonymous'; AuthGate redirects to login.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      const store = useAuthStore.getState();
      try {
        const refresh = await api.post<{ accessToken: string }>('/auth/refresh');
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
