'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { loginSchema, type AuthUser, type LoginInput } from '@avishifo/shared';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore, type MeResponse } from '@/stores/auth-store';
import { Link, useRouter } from '@/i18n/routing';
import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
}

/** Demo/staging helper — hidden when NEXT_PUBLIC_DEMO_LOGINS="false". */
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS !== 'false';

const DEMO_ACCOUNTS = [
  { roleKey: 'role.CLINIC_OWNER', identifier: 'owner@shifomed.uz', password: 'Demo123!' },
  { roleKey: 'role.CLINIC_ADMIN', identifier: 'admin@shifomed.uz', password: 'Demo123!' },
  { roleKey: 'role.DOCTOR', identifier: 'kardiolog@shifomed.uz', password: 'Demo123!' },
  { roleKey: 'role.RECEPTIONIST', identifier: 'qabul1@shifomed.uz', password: 'Demo123!' },
  { roleKey: 'role.CASHIER', identifier: 'kassir@shifomed.uz', password: 'Demo123!' },
  { roleKey: 'role.LAB_TECH', identifier: 'labor@shifomed.uz', password: 'Demo123!' },
  { roleKey: 'role.SUPER_ADMIN', identifier: 'admin@avishifo.uz', password: 'Admin123!' },
] as const;

export function LoginForm() {
  const t = useTranslations('auth');
  const tErr = useTranslations('errors');
  const tStatus = useTranslations('statuses');
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await api.post<LoginResponse>('/auth/login', values, undefined);
      // Login returns only { user, accessToken }; clinic + branches come from /auth/me.
      useAuthStore.getState().setAccessToken(res.data.accessToken);
      const me = await api.get<MeResponse>('/auth/me');
      setSession({ ...me.data, accessToken: res.data.accessToken });
      router.replace(res.data.user.role === 'SUPER_ADMIN' ? '/platform/clinics' : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError) setServerError(tErr(err.code as never));
      else setServerError(tErr('INTERNAL_ERROR'));
    }
  });

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-2 text-center">
        <LogoMark className="mx-auto h-14 w-14" />
        <CardTitle className="text-2xl">{t('loginTitle')}</CardTitle>
        <CardDescription>{t('loginSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="identifier">{t('identifier')}</Label>
            <Input
              id="identifier"
              autoComplete="username"
              placeholder={t('identifierPlaceholder')}
              {...form.register('identifier')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          </div>
          {serverError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('loggingIn') : t('login')}
          </Button>
        </form>

        <div className="mt-6 space-y-3 border-t pt-4">
          <p className="text-center text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">
              {t('registerFree')}
            </Link>
          </p>
          <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
            <Link href="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('backHome')}
            </Link>
          </Button>
        </div>

        {SHOW_DEMO ? (
          <details className="mt-6 rounded-lg border bg-muted/40 p-3 text-sm">
            <summary className="cursor-pointer select-none font-medium text-muted-foreground">
              {t('demoAccounts')}
            </summary>
            <div className="mt-3 grid gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.identifier}
                  type="button"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  onClick={() => {
                    form.setValue('identifier', acc.identifier);
                    form.setValue('password', acc.password);
                    setServerError(null);
                  }}
                >
                  <span className="font-medium">{tStatus(acc.roleKey as never)}</span>
                  <span className="text-xs text-muted-foreground">{acc.identifier}</span>
                </button>
              ))}
              <p className="mt-1 px-2 text-xs text-muted-foreground">{t('demoDisplayHint')}</p>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
