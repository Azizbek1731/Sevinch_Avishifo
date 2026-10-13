'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/stores/auth-store';
import { homePath } from '@/lib/home-path';
import { LoginForm } from '@/features/auth/login-form';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirror of AuthGate for the other direction: a visitor who still has a valid
 * refresh cookie is sent to their home instead of being asked to sign in again.
 * The form waits for the bootstrap to settle so it never flashes for them.
 *
 * This also handles a successful sign-in: the form stores the session and this
 * page performs the role-aware redirect once.
 */
export default function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    router.replace(homePath(user));
  }, [status, user, router]);

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
