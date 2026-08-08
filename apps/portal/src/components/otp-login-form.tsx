'use client';

import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  formatPhone,
  normalizePhone,
  portalRequestOtpSchema,
  portalVerifyOtpSchema,
  type PortalVerifyOtpInput,
} from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import { PhoneInput, formatPhoneDisplay } from '@/components/phone-input';
import { OtpInput } from '@/components/otp-input';
import { Spinner } from '@/components/spinner';

/** Form-level schema: masked display string that must normalize to +998XXXXXXXXX. */
const phoneFormSchema = z.object({
  phoneDisplay: z.string().refine((v) => normalizePhone(v) !== null, {
    message: "Telefon raqamni to'liq kiriting",
  }),
});
type PhoneFormValues = z.infer<typeof phoneFormSchema>;

const RESEND_SECONDS = 60;

interface OtpLoginFormProps {
  /** Normalized or raw phone to prefill. */
  initialPhone?: string;
  /** `isNew` is true when the verified phone has no profile name / patient card yet. */
  onSuccess: (token: string, phone: string, isNew: boolean) => void;
}

/** Two-step phone → OTP login. Reused by /login and inline in the booking wizard. */
export function OtpLoginForm({ initialPhone, onSuccess }: OtpLoginFormProps) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  // Bumped after a rejected code: remounting OtpInput empties the six boxes and
  // puts the caret back in the first one, so a retry is one tap, not six.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const phoneForm = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneFormSchema),
    defaultValues: {
      phoneDisplay: initialPhone !== undefined ? formatPhoneDisplay(initialPhone) : '',
    },
  });

  const codeForm = useForm<PortalVerifyOtpInput>({
    resolver: zodResolver(portalVerifyOtpSchema),
    defaultValues: { phone: '', code: '' },
  });

  const requestOtp = useMutation({
    mutationFn: async (normalized: string) => {
      const body = portalRequestOtpSchema.parse({ phone: normalized });
      await api.post('/portal/auth/request-otp', body, { anonymous: true });
      return normalized;
    },
    onSuccess: (normalized) => {
      setPhone(normalized);
      codeForm.reset({ phone: normalized, code: '' });
      setStep('code');
      setResendIn(RESEND_SECONDS);
      toast.success('Tasdiqlash kodi yuborildi');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const verifyOtp = useMutation({
    mutationFn: async (values: PortalVerifyOtpInput) => {
      const body = portalVerifyOtpSchema.parse(values);
      const res = await api.post<{ accessToken: string; isNew: boolean }>(
        '/portal/auth/verify',
        body,
        { anonymous: true },
      );
      return res.data;
    },
    onSuccess: (data, values) => {
      toast.success('Xush kelibsiz!');
      onSuccess(data.accessToken, values.phone, data.isNew);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      codeForm.setValue('code', '');
      setAttempt((n) => n + 1);
    },
  });

  if (step === 'phone') {
    return (
      <form
        onSubmit={phoneForm.handleSubmit((values) => {
          const normalized = normalizePhone(values.phoneDisplay);
          if (normalized !== null) requestOtp.mutate(normalized);
        })}
        className="space-y-4"
      >
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">
            Telefon raqamingiz
          </label>
          <Controller
            control={phoneForm.control}
            name="phoneDisplay"
            render={({ field, fieldState }) => (
              <>
                <PhoneInput
                  id="phone"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  invalid={fieldState.error !== undefined}
                  disabled={requestOtp.isPending}
                />
                {fieldState.error !== undefined && (
                  <p className="mt-1 text-sm text-red-600">Telefon raqamni to&apos;liq kiriting</p>
                )}
              </>
            )}
          />
        </div>
        <button
          type="submit"
          disabled={requestOtp.isPending}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {requestOtp.isPending ? <Spinner className="h-5 w-5 text-white" /> : 'Kod olish'}
        </button>
        <p className="text-center text-xs text-slate-500">
          6 xonali kod Telegramingizga yuboriladi. Telegram bo‘lmasa — SMS orqali.
        </p>
      </form>
    );
  }

  return (
    <form
      onSubmit={codeForm.handleSubmit((values) => verifyOtp.mutate(values))}
      className="space-y-4"
    >
      <p className="text-center text-sm text-slate-600">
        <span className="font-semibold text-slate-900">
          {phone !== null ? formatPhone(phone) : ''}
        </span>{' '}
        raqamiga yuborilgan 6 xonali kodni kiriting
      </p>
      <p className="text-center text-xs text-slate-500">
        Telegramingizni tekshiring — kod «Verification Codes» dan keladi.
      </p>
      <Controller
        control={codeForm.control}
        name="code"
        render={({ field, fieldState }) => (
          <>
            <OtpInput
              key={attempt}
              value={field.value}
              onChange={field.onChange}
              // Nobody should have to reach for a button after the last digit —
              // and an autofilled code would otherwise just sit there.
              onComplete={(code) => {
                if (phone !== null && !verifyOtp.isPending) verifyOtp.mutate({ phone, code });
              }}
              disabled={verifyOtp.isPending}
              autoFocus
            />
            {fieldState.error !== undefined && (
              <p className="text-center text-sm text-red-600">Kod 6 ta raqamdan iborat bo&apos;lishi kerak</p>
            )}
          </>
        )}
      />
      <button
        type="submit"
        disabled={verifyOtp.isPending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
      >
        {verifyOtp.isPending ? <Spinner className="h-5 w-5 text-white" /> : 'Tasdiqlash'}
      </button>
      <div className="-mx-2 flex items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setStep('phone');
            setPhone(null);
          }}
          className="inline-flex min-h-11 items-center px-2 text-left text-slate-500 hover:text-slate-700"
        >
          Raqamni o&apos;zgartirish
        </button>
        {resendIn > 0 ? (
          <span className="px-2 text-right text-slate-400">Qayta yuborish: {resendIn} s</span>
        ) : (
          <button
            type="button"
            disabled={requestOtp.isPending || phone === null}
            onClick={() => {
              if (phone !== null) requestOtp.mutate(phone);
            }}
            className="inline-flex min-h-11 items-center px-2 text-right font-medium text-brand hover:text-brand-dark disabled:opacity-60"
          >
            Kodni qayta yuborish
          </button>
        )}
      </div>
    </form>
  );
}
