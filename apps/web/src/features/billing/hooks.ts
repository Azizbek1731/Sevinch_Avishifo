'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { Permission } from '@avishifo/shared';

/** Toast an ApiError with the localized message for its error code. */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) toast.error(tErr(err.code as never));
      else toast.error(tErr('INTERNAL_ERROR'));
    },
    [tErr],
  );
}

/** Permission check against the authenticated user. */
export function usePermission(): (permission: Permission) => boolean {
  const user = useAuthStore((s) => s.user);
  return useCallback(
    (permission: Permission) => user?.permissions.includes(permission) ?? false,
    [user],
  );
}

/** Invalidate all billing-related caches after money moved. */
export function useInvalidateBilling(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
    void queryClient.invalidateQueries({ queryKey: ['debtors'] });
    void queryClient.invalidateQueries({ queryKey: ['balance'] });
  }, [queryClient]);
}
