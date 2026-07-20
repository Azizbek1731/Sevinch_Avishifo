'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PortalProfile } from '@/lib/types';

/** Shared query for the durable portal profile (account + cards + stats + telegram). */
export function useProfile(enabled = true) {
  return useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => api.get<PortalProfile>('/portal/me/profile').then((r) => r.data),
    enabled,
  });
}
