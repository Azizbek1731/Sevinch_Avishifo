'use client';

import type { Permission } from '@avishifo/shared';
import { useAuthStore } from '@/stores/auth-store';

/** Permission check against the authenticated user's permission set. */
export function usePermissions(): (p: Permission) => boolean {
  const permissions = useAuthStore((s) => s.user?.permissions);
  return (p: Permission) => (permissions ?? []).includes(p);
}
