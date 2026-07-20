'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
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

  const registerParams = new URLSearchParams();
  if (initialPhone !== undefined) registerParams.set('phone', initialPhone);
  const nextRaw = searchParams.get('next');
  if (nextRaw !== null) registerParams.set('next', nextRaw);
  const registerHref = `/register${registerParams.toString() ? `?${registerParams.toString()}` : ''}`;

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
          onSuccess={(token, phone, isNew) => {
            login(phone, token);
            // Brand-new patient (no name/card yet): land on the profile page,
            // which prompts them to complete their details.
            router.replace(isNew ? '/me/profile' : next);
          }}
        />
      </SectionCard>
      <p className="mt-4 text-center text-sm text-slate-500">
        Akkauntingiz yo‘qmi?{' '}
        <Link href={registerHref} className="font-medium text-brand hover:underline">
          Ro‘yxatdan o‘tish
        </Link>
      </p>
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
