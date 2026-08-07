'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { LoginForm } from '@/features/auth/login-form';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirror of AuthGate for the other direction: a visitor who still has a valid
 * refresh cookie is sent to their home instead of being asked to sign in again.
 * The form waits for the bootstrap to settle so it never flashes for them.
 */
export default function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const router = useRouter();

  useEffect(() => {
    if (status !== 'authenticated') return;
    router.replace(role === 'SUPER_ADMIN' ? '/platform/clinics' : '/dashboard');
  }, [status, role, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      {status === 'anonymous' ? (
        <LoginForm />
      ) : (
        <Skeleton className="h-[28rem] w-full max-w-md rounded-xl" />
      )}
    </main>
  );
}
