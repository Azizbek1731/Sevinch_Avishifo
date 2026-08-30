'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Toast an ApiError.
 *
 * The server's own message wins when it has one. Several refusals are written
 * to be read by the person who hit them — "To'lanmagan 3 ta xizmat bor, avval
 * hisob-faktura chiqaring" — and collapsing those to the generic text for
 * VALIDATION_ERROR made the button look broken rather than answered.
 */
export function useApiErrorToast(): (err: unknown) => void {
  const tErr = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      if (!(err instanceof ApiError)) {
        toast.error(tErr('INTERNAL_ERROR'));
        return;
      }
      const generic = tErr(err.code as never);
      const detail = err.message?.trim();
      // Skip a message that is just the code echoed back, or an English
      // developer string the front desk cannot act on.
      const useful = detail && detail !== err.code && detail.length > 3;
      toast.error(useful ? detail : generic);
    },
    [tErr],
  );
}

/** True when the current user may mutate the service catalog. */
export function useCanWriteServices(): boolean {
  const user = useAuthStore((s) => s.user);
  return user?.permissions.includes('services.write') ?? false;
}
