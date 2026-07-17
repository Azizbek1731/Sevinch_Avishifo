'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { loginSchema, type AuthUser, type LoginInput } from '@avishifo/shared';
import { HeartPulse } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore, type BranchInfo, type ClinicInfo } from '@/stores/auth-store';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LoginResponse {
  user: AuthUser;
  clinic: ClinicInfo | null;
  branches: BranchInfo[];
  accessToken: string;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tErr = useTranslations('errors');
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
      setSession(res.data);
      router.replace(res.data.user.role === 'SUPER_ADMIN' ? '/platform/clinics' : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError) setServerError(tErr(err.code as never));
      else setServerError(tErr('INTERNAL_ERROR'));
    }
  });

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <HeartPulse className="h-7 w-7" />
        </div>
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
            <Input
              id="password"
              type="password"
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
      </CardContent>
    </Card>
  );
}
