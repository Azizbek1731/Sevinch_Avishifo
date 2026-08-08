'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { Skeleton } from '@/components/ui/skeleton';

/** Blocks protected pages until the session is bootstrapped; redirects anonymous users. */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 border-r p-4 md:block">
          <Skeleton className="mb-6 h-10 w-full" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-8 w-full" />
          ))}
        </div>
        <div className="flex-1 p-4 md:p-6">
          <Skeleton className="mb-6 h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
