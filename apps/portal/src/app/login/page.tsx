'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OtpLoginForm } from '@/components/otp-login-form';
import { PageLoader } from '@/components/spinner';
import { SectionCard } from '@/components/section-card';
import { useSession } from '@/stores/session';

function safeNext(raw: string | null): string {
  return raw !== null && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/me';
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = useSession((s) => s.status);
  const login = useSession((s) => s.login);

  const next = safeNext(searchParams.get('next'));
  const initialPhone = searchParams.get('phone') ?? undefined;

  useEffect(() => {
    if (status === 'authed') router.replace(next);
  }, [status, next, router]);

  if (status === 'loading' || status === 'authed') return <PageLoader />;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-center text-2xl font-bold">Kirish</h1>
      <p className="mb-5 text-center text-sm text-slate-500">
        Telefon raqamingiz orqali tizimga kiring
      </p>
      <SectionCard>
        <OtpLoginForm
          initialPhone={initialPhone}
          onSuccess={(token, phone) => {
            login(phone, token);
            router.replace(next);
          }}
        />
      </SectionCard>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <LoginContent />
    </Suspense>
  );
}
