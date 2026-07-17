'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

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

/** True when the current user may mutate the service catalog. */
export function useCanWriteServices(): boolean {
  const user = useAuthStore((s) => s.user);
  return user?.permissions.includes('services.write') ?? false;
}
