'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { HeartPulse, ShieldCheck } from 'lucide-react';
import {
  normalizePhone,
  registerClinicSchema,
  type AuthUser,
  type RegisterClinicInput,
} from '@avishifo/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore, type MeResponse } from '@/stores/auth-store';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface RegisterResponse {
  user: AuthUser;
  accessToken: string;
  trialEndsAt: string | null;
}

/**
 * Public clinic sign-up: the director creates the clinic and lands straight in
 * the panel on a free trial. No verification step — see DECISIONS.md.
 */
export function RegisterForm({ trialDays = 7 }: { trialDays?: number }) {
  const t = useTranslations('auth');
  const tErr = useTranslations('errors');
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<RegisterClinicInput>({
    resolver: zodResolver(registerClinicSchema),
    defaultValues: { clinicName: '', fullName: '', phone: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await api.post<RegisterResponse>('/auth/register-clinic', values, undefined);
      useAuthStore.getState().setAccessToken(res.data.accessToken);
      const me = await api.get<MeResponse>('/auth/me');
      setSession({ ...me.data, accessToken: res.data.accessToken });
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) setServerError(tErr(err.code as never));
      else setServerError(tErr('INTERNAL_ERROR'));
    }
  });

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <HeartPulse className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl">{t('register.title')}</CardTitle>
        <CardDescription>{t('register.subtitle', { days: trialDays })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="clinicName">{t('register.clinicName')}</Label>
            <Input
              id="clinicName"
              autoComplete="organization"
              placeholder={t('register.clinicNamePlaceholder')}
              {...form.register('clinicName')}
            />
            {form.formState.errors.clinicName ? (
              <p className="text-sm text-destructive">{t('register.clinicNameInvalid')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">{t('register.fullName')}</Label>
            <Input
              id="fullName"
              autoComplete="name"
              placeholder={t('register.fullNamePlaceholder')}
              {...form.register('fullName')}
            />
            {form.formState.errors.fullName ? (
              <p className="text-sm text-destructive">{t('register.fullNameInvalid')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">{t('register.phone')}</Label>
            <Input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+998 90 123-45-67"
              {...form.register('phone', {
                setValueAs: (v: unknown) => normalizePhone(String(v ?? '')) ?? String(v ?? ''),
              })}
            />
            {form.formState.errors.phone ? (
              <p className="text-sm text-destructive">{t('register.phoneInvalid')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t('register.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={t('register.emailPlaceholder')}
              // Email is optional: an empty box must read as "absent", not as an
              // invalid address, or zod blocks the submit with no visible reason.
              {...form.register('email', {
                setValueAs: (v: unknown) => {
                  const s = String(v ?? '').trim();
                  return s === '' ? undefined : s;
                },
              })}
            />
            {form.formState.errors.email ? (
              <p className="text-sm text-destructive">{t('register.emailInvalid')}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t('register.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            {form.formState.errors.password ? (
              <p className="text-sm text-destructive">{t('register.passwordInvalid')}</p>
            ) : null}
          </div>

          {serverError ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {serverError}
            </p>
          ) : null}

          <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('register.submitting') : t('register.submit')}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('register.noCard')}
          </p>

          <p className="text-center text-sm text-muted-foreground">
            {t('register.haveAccount')}{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t('register.signIn')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
