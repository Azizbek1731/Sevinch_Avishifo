'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import {
  formatNationalPhone,
  loginSchema,
  phoneSchema,
  phoneWireValue,
  type AuthUser,
  type LoginInput,
} from '@avishifo/shared';
import { ArrowLeft, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore, type MeResponse } from '@/stores/auth-store';
import { Link, useRouter } from '@/i18n/routing';
import { LogoMark } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
}

/** Password accepted, but the account has the Telegram second factor on. */
interface TwoFactorPending {
  twoFactorRequired: true;
  challengeId: string;
  expiresInSeconds: number;
  hint: string | null;
}

type LoginResult = LoginResponse | TwoFactorPending;

function isTwoFactor(r: LoginResult): r is TwoFactorPending {
  return 'twoFactorRequired' in r;
}

/**
 * A code is waiting to be typed. Both ways in end up here; the source decides
 * which endpoint verifies the code and which step "back" returns to.
 */
type PendingCode =
  | { source: 'password'; challengeId: string; hint: string | null }
  | { source: 'telegram'; challengeId: string; phone: string };

const telegramPhoneSchema = z.object({ phone: phoneSchema });
type TelegramPhoneInput = z.infer<typeof telegramPhoneSchema>;

/** Public bot handle — the chat a code can only reach once the account is linked. */
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? 'AviShifoBot';

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
  /** Which way in the user picked; the code screen sits on top of both. */
  const [step, setStep] = useState<'password' | 'telegram'>('password');
  /** Non-null once a step returned a challenge instead of a session. */
  const [pending, setPending] = useState<PendingCode | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const phoneForm = useForm<TelegramPhoneInput>({
    resolver: zodResolver(telegramPhoneSchema),
    defaultValues: { phone: '' },
  });

  function toMessage(err: unknown): string {
    return err instanceof ApiError ? tErr(err.code as never) : tErr('INTERNAL_ERROR');
  }

  /** Switch steps with nothing left over — a stale code must never be sent against a fresh challenge. */
  function goTo(next: 'password' | 'telegram'): void {
    setServerError(null);
    setPending(null);
    setCode('');
    phoneForm.reset({ phone: '' });
    setStep(next);
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await api.post<LoginResult>('/auth/login', values, undefined);
      if (isTwoFactor(res.data)) {
        setPending({
          source: 'password',
          challengeId: res.data.challengeId,
          hint: res.data.hint,
        });
        return;
      }
      await establishSession(res.data);
    } catch (err) {
      setServerError(toMessage(err));
    }
  });

  const onRequestCode = phoneForm.handleSubmit(async ({ phone }) => {
    setServerError(null);
    try {
      const res = await api.post<{ challengeId: string; expiresInSeconds: number }>(
        '/auth/telegram/request-code',
        { phone },
        undefined,
      );
      setCode('');
      setPending({ source: 'telegram', challengeId: res.data.challengeId, phone });
    } catch (err) {
      setServerError(toMessage(err));
    }
  });

  /** Login returns only { user, accessToken }; clinic + branches come from /auth/me. */
  async function establishSession(data: LoginResponse): Promise<void> {
    useAuthStore.getState().setAccessToken(data.accessToken);
    const me = await api.get<MeResponse>('/auth/me');
    setSession({ ...me.data, accessToken: data.accessToken });
    // Everyone used to land on /dashboard, which needs reports.read — a
    // receptionist's first screen was a spinner over 403s. Land each role where
    // its day actually starts.
    const home =
      data.user.role === 'SUPER_ADMIN'
        ? '/platform/clinics'
        : data.user.permissions.includes('reports.read')
          ? '/dashboard'
          : data.user.permissions.includes('queue.manage')
            ? '/reception'
            : data.user.permissions.includes('queue.call')
              ? '/doctor'
              : data.user.permissions.includes('payments.create')
                ? '/cashier'
                : data.user.permissions.includes('lab.orders.write')
                  ? '/lab'
                  : data.user.permissions.includes('queue.read')
                    ? '/queue'
                    : '/patients';
    router.replace(home);
  }

  async function onVerify(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!pending || code.length !== 6) return;
    setServerError(null);
    setVerifying(true);
    try {
      const res = await api.post<LoginResponse>(
        pending.source === 'telegram' ? '/auth/telegram/verify' : '/auth/two-factor/verify',
        { challengeId: pending.challengeId, code },
        undefined,
      );
      await establishSession(res.data);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(tErr(err.code as never));
        // An expired or burned challenge cannot be retried — go back to the step
        // that issued it rather than leaving the user typing into a dead form.
        if (err.code === 'TWO_FACTOR_CHALLENGE_INVALID') {
          setPending(null);
          setCode('');
        }
      } else setServerError(tErr('INTERNAL_ERROR'));
    } finally {
      setVerifying(false);
    }
  }

  if (pending) {
    return (
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-2 text-center">
          <LogoMark className="mx-auto h-14 w-14" />
          <CardTitle className="text-2xl">{t('twoFactor.title')}</CardTitle>
          <CardDescription>
            {pending.source === 'telegram'
              ? t('telegramLogin.sent', { phone: `+998 ${formatNationalPhone(pending.phone)}` })
              : pending.hint
                ? t('twoFactor.subtitleWithHint', { hint: pending.hint })
                : t('twoFactor.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onVerify} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="code">{t('twoFactor.code')}</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="000000"
                // The indent offsets the trailing letter-space so the six digits
                // read as centred rather than nudged left.
                className="h-14 text-center font-mono text-2xl tracking-[0.4em] indent-[0.4em] md:h-12"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setServerError(null);
                }}
              />
            </div>
            {serverError ? (
              <p className="text-sm font-medium text-destructive" role="alert">
                {serverError}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={verifying || code.length !== 6}
            >
              {verifying ? t('twoFactor.verifying') : t('twoFactor.verify')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => goTo(pending.source === 'telegram' ? 'telegram' : 'password')}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              {pending.source === 'telegram' ? t('telegramLogin.backToPhone') : t('twoFactor.back')}
            </Button>
          </form>

          {pending.source === 'telegram' ? (
            <div className="mt-5 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{t('telegramLogin.noCodeTitle')}</p>
              <p className="text-muted-foreground">{t('telegramLogin.noCode')}</p>
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={`https://t.me/${BOT_USERNAME}`} target="_blank" rel="noreferrer noopener">
                  <Send className="h-4 w-4" />
                  {t('telegramLogin.openBot', { bot: BOT_USERNAME })}
                </a>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (step === 'telegram') {
    return (
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-2 text-center">
          <LogoMark className="mx-auto h-14 w-14" />
          <CardTitle className="text-2xl">{t('telegramLogin.title')}</CardTitle>
          <CardDescription>{t('telegramLogin.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onRequestCode} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="telegram-phone">{t('telegramLogin.phone')}</Label>
              <PhoneInput
                id="telegram-phone"
                autoFocus
                {...phoneForm.register('phone', { setValueAs: phoneWireValue })}
              />
              {phoneForm.formState.errors.phone ? (
                <p className="text-sm text-destructive">{t('telegramLogin.phoneInvalid')}</p>
              ) : null}
            </div>
            {serverError ? (
              <p className="text-sm font-medium text-destructive" role="alert">
                {serverError}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={phoneForm.formState.isSubmitting}
            >
              {phoneForm.formState.isSubmitting
                ? t('telegramLogin.submitting')
                : t('telegramLogin.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => goTo('password')}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('telegramLogin.passwordInstead')}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {t('telegramLogin.linkHint')}
          </p>
        </CardContent>
      </Card>
    );
  }

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
          <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('loggingIn') : t('login')}
          </Button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-card px-2 text-xs uppercase text-muted-foreground">{t('or')}</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => goTo('telegram')}
        >
          <Send className="h-4 w-4" />
          {t('telegramLogin.cta')}
        </Button>

        <div className="mt-6 space-y-3 border-t pt-4">
          <p className="text-center text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            {/* The padding grows the thumb target; the equal negative margin
                keeps the line box — and so the whole card — where it was. */}
            <Link
              href="/register"
              className="font-medium text-primary hover:underline max-md:-my-3 max-md:inline-block max-md:py-3"
            >
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
            <summary className="flex min-h-11 cursor-pointer select-none items-center font-medium text-muted-foreground md:min-h-0">
              {t('demoAccounts')}
            </summary>
            <div className="mt-3 grid gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.identifier}
                  type="button"
                  className="flex min-h-11 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent md:min-h-0"
                  onClick={() => {
                    form.setValue('identifier', acc.identifier);
                    form.setValue('password', acc.password);
                    setServerError(null);
                  }}
                >
                  <span className="font-medium">{tStatus(acc.roleKey as never)}</span>
                  <span className="truncate text-xs text-muted-foreground">{acc.identifier}</span>
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
