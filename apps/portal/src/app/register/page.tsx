'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { LogoMark } from '@/components/logo-mark';
import { Gender, type PortalUpdateProfileInput } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import type { PortalProfile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { OtpLoginForm } from '@/components/otp-login-form';
import { SectionCard } from '@/components/section-card';
import { PageLoader, Spinner } from '@/components/spinner';

function safeNext(raw: string | null): string {
  return raw !== null && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/me';
}

const inputBase =
  'h-12 w-full rounded-xl border bg-white px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 disabled:bg-slate-100';

function inputClass(invalid: boolean): string {
  return `${inputBase} ${
    invalid
      ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
      : 'border-slate-300 focus:border-brand focus:ring-brand/20'
  }`;
}

const GENDER_OPTIONS = [
  { value: Gender.MALE, label: 'Erkak' },
  { value: Gender.FEMALE, label: 'Ayol' },
] as const;

const profileFormSchema = z.object({
  firstName: z.string().trim().min(1, { message: 'Ismingizni kiriting' }),
  lastName: z.string().trim().min(1, { message: 'Familiyangizni kiriting' }),
  dob: z.string().optional(),
  gender: z.nativeEnum(Gender).optional(),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** Second step: capture the new patient's name (and optional DOB / gender). */
function CompleteProfileForm({ next }: { next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { firstName: '', lastName: '', dob: '', gender: undefined },
  });

  const gender = watch('gender');
  const today = new Date().toISOString().slice(0, 10);

  const saveProfile = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const payload: PortalUpdateProfileInput = {
        firstName: values.firstName,
        lastName: values.lastName,
        ...(values.dob !== undefined && values.dob !== '' ? { dob: values.dob } : {}),
        ...(values.gender !== undefined ? { gender: values.gender } : {}),
      };
      const res = await api.post<PortalProfile>('/portal/me/profile', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-profile'] });
      queryClient.invalidateQueries({ queryKey: ['portal-me'] });
      toast.success('Xush kelibsiz! Profilingiz yaratildi');
      router.replace(next);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => saveProfile.mutate(values))}
      className="space-y-4"
    >
      <div>
        <label htmlFor="firstName" className="mb-1.5 block text-sm font-medium text-slate-700">
          Ism
        </label>
        <input
          id="firstName"
          type="text"
          autoComplete="given-name"
          placeholder="Ism"
          disabled={saveProfile.isPending}
          aria-invalid={errors.firstName !== undefined}
          className={inputClass(errors.firstName !== undefined)}
          {...register('firstName')}
        />
        {errors.firstName !== undefined && (
          <p className="mt-1 text-sm text-red-600">{errors.firstName.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="lastName" className="mb-1.5 block text-sm font-medium text-slate-700">
          Familiya
        </label>
        <input
          id="lastName"
          type="text"
          autoComplete="family-name"
          placeholder="Familiya"
          disabled={saveProfile.isPending}
          aria-invalid={errors.lastName !== undefined}
          className={inputClass(errors.lastName !== undefined)}
          {...register('lastName')}
        />
        {errors.lastName !== undefined && (
          <p className="mt-1 text-sm text-red-600">{errors.lastName.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="dob" className="mb-1.5 block text-sm font-medium text-slate-700">
          Tug&apos;ilgan sana <span className="font-normal text-slate-400">(ixtiyoriy)</span>
        </label>
        <input
          id="dob"
          type="date"
          max={today}
          disabled={saveProfile.isPending}
          className={inputClass(false)}
          {...register('dob')}
        />
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          Jins <span className="font-normal text-slate-400">(ixtiyoriy)</span>
        </span>
        <div className="flex gap-2">
          {GENDER_OPTIONS.map((option) => {
            const selected = gender === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={saveProfile.isPending}
                aria-pressed={selected}
                onClick={() =>
                  setValue('gender', selected ? undefined : option.value, {
                    shouldDirty: true,
                  })
                }
                className={`h-12 flex-1 rounded-xl border text-sm font-medium transition disabled:opacity-60 ${
                  selected
                    ? 'border-brand bg-brand-light text-brand-dark'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={saveProfile.isPending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {saveProfile.isPending ? <Spinner className="h-5 w-5 text-white" /> : 'Yakunlash'}
      </button>
    </form>
  );
}

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = useSession((s) => s.status);
  const login = useSession((s) => s.login);

  const next = safeNext(searchParams.get('next'));
  const initialPhone = searchParams.get('phone') ?? undefined;

  const [phase, setPhase] = useState<'otp' | 'profile'>('otp');
  // Set the moment we verify OTP so the "already authed → bounce" effect below
  // doesn't fire when our own login() call flips the session to 'authed'.
  const handedOff = useRef(false);

  useEffect(() => {
    if (status === 'authed' && !handedOff.current) router.replace(next);
  }, [status, next, router]);

  const handleVerified = (token: string, phone: string, isNew: boolean) => {
    handedOff.current = true;
    login(phone, token);
    if (!isNew) {
      toast.success("Siz allaqachon ro'yxatdan o'tgansiz");
      router.replace(next);
      return;
    }
    setPhase('profile');
  };

  // Preserve ?phone / ?next when pointing the user at the login page.
  const loginParams = new URLSearchParams();
  const phoneParam = searchParams.get('phone');
  const nextParam = searchParams.get('next');
  if (phoneParam !== null) loginParams.set('phone', phoneParam);
  if (nextParam !== null) loginParams.set('next', nextParam);
  const loginQuery = loginParams.toString();
  const loginHref = loginQuery.length > 0 ? `/login?${loginQuery}` : '/login';

  // Show the registration card only while the user still has something to do here:
  // entering OTP as a guest, or filling in the profile after signing up. Otherwise
  // (loading, or an already-authed session) we render a loader while redirecting.
  const showCard = phase === 'profile' || (phase === 'otp' && status === 'guest');
  if (!showCard) return <PageLoader />;

  const subtitle =
    phase === 'profile'
      ? "Bir qadam qoldi — o'zingiz haqingizda ma'lumot bering"
      : "Telefon raqamingiz orqali tez va oson ro'yxatdan o'ting";

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 flex flex-col items-center text-center">
        <LogoMark className="mb-3 h-16 w-16" />
        <h1 className="text-2xl font-bold">Ro&apos;yxatdan o&apos;tish</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <SectionCard>
        {phase === 'otp' ? (
          <OtpLoginForm initialPhone={initialPhone} onSuccess={handleVerified} />
        ) : (
          <CompleteProfileForm next={next} />
        )}
      </SectionCard>

      {phase === 'otp' && (
        <p className="mt-4 text-center text-sm text-slate-500">
          Akkauntingiz bormi?{' '}
          <Link href={loginHref} className="font-medium text-brand hover:underline">
            Kirish
          </Link>
        </p>
      )}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <RegisterContent />
    </Suspense>
  );
}
