'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  FlaskConical,
  LogOut,
  Mail,
  Pencil,
  Send,
  Stethoscope,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatPhone } from '@avishifo/shared';
import { api, errorMessage } from '@/lib/api';
import type { PortalProfile, PortalTelegramLinkToken } from '@/lib/types';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/stores/session';
import { Avatar } from '@/components/avatar';
import { SectionCard } from '@/components/section-card';
import { PageLoader, Spinner } from '@/components/spinner';

const GENDER_LABEL: Record<string, string> = { MALE: 'Erkak', FEMALE: 'Ayol' };
const LOCALE_LABEL: Record<string, string> = {
  uz: "O‘zbekcha",
  'uz-Cyrl': 'Ўзбекча',
  ru: 'Русский',
  en: 'English',
};

/** "YYYY-MM-DD" → "DD.MM.YYYY" (unambiguous, timezone-free). */
function formatDob(dob: string | null): string {
  if (!dob) return '—';
  const [y, m, d] = dob.split('-');
  return d && m && y ? `${d}.${m}.${y}` : dob;
}

export default function ProfilePage() {
  const authStatus = useRequireAuth();
  const profileQ = useProfile(authStatus === 'authed');

  if (authStatus !== 'authed' || profileQ.isPending) return <PageLoader />;
  if (profileQ.isError) {
    return <p className="text-sm text-red-600">{errorMessage(profileQ.error)}</p>;
  }
  return <ProfileView profile={profileQ.data} />;
}

function ProfileView({ profile }: { profile: PortalProfile }) {
  const [editing, setEditing] = useState(false);
  const incomplete = !profile.firstName || !profile.lastName;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Profil</h1>

      {/* Identity header */}
      <SectionCard>
        <div className="flex items-center gap-4">
          <Avatar name={profile.fullName || profile.phone} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-slate-900">
              {profile.fullName || 'Ismsiz foydalanuvchi'}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-slate-500">
              {formatPhone(profile.phone)}
              {profile.phoneVerified && (
                <span className="inline-flex items-center gap-0.5 text-brand" title="Tasdiqlangan">
                  <BadgeCheck className="h-4 w-4" />
                </span>
              )}
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" />
              Tahrirlash
            </button>
          )}
        </div>

        {incomplete && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-4 flex w-full items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 transition hover:bg-amber-100"
          >
            <span>Profilingizni to‘ldiring — ism va familiyangizni kiriting</span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>
        )}
      </SectionCard>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          href="/me/appointments"
          icon={CalendarDays}
          value={profile.stats.upcomingAppointments}
          label="Qabullar"
        />
        <StatTile
          href="/me/visits"
          icon={Stethoscope}
          value={profile.stats.visits}
          label="Tashriflar"
        />
        <StatTile
          href="/me/results"
          icon={FlaskConical}
          value={profile.stats.labResults}
          label="Natijalar"
        />
        <StatTile
          href="/me/documents"
          icon={FileText}
          value={profile.stats.documents}
          label="Hujjatlar"
        />
      </div>

      {/* Personal info */}
      {editing ? (
        <EditForm profile={profile} onDone={() => setEditing(false)} />
      ) : (
        <SectionCard title="Shaxsiy ma'lumotlar">
          <dl className="divide-y divide-slate-100">
            <InfoRow label="Ism" value={profile.firstName ?? '—'} />
            <InfoRow label="Familiya" value={profile.lastName ?? '—'} />
            <InfoRow label="Tug‘ilgan sana" value={formatDob(profile.dob)} />
            <InfoRow
              label="Jins"
              value={profile.gender ? (GENDER_LABEL[profile.gender] ?? profile.gender) : '—'}
            />
            <InfoRow label="Email" value={profile.email || '—'} />
            <InfoRow label="Til" value={LOCALE_LABEL[profile.preferredLocale] ?? profile.preferredLocale} />
          </dl>
        </SectionCard>
      )}

      {/* Telegram */}
      <TelegramCard profile={profile} />

      {/* Notification preferences */}
      <NotificationPrefs profile={profile} />

      {/* Clinics */}
      <SectionCard title="Klinikalarim">
        {profile.clinics.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            Hozircha bemor kartangiz yo‘q. Klinikaga birinchi yozilganingizda karta ochiladi.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {profile.clinics.map((card) => (
              <li key={`${card.clinicId}:${card.patientId}`}>
                <Link
                  href={`/c/${card.clinicId}`}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{card.clinicName}</span>
                      <span className="block text-sm text-slate-500">
                        {card.fullName} · {card.mrn}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <LogoutButton />
    </div>
  );
}

// --------------------------------------------------------------- subcomponents

function StatTile({
  href,
  icon: Icon,
  value,
  label,
}: {
  href: string;
  icon: typeof CalendarDays;
  value: number;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:border-brand"
    >
      <Icon className="h-5 w-5 text-brand" />
      <span className="text-xl font-bold text-slate-900 tabular-nums">{value}</span>
      <span className="text-xs font-medium text-slate-500">{label}</span>
    </Link>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

interface EditValues {
  firstName: string;
  lastName: string;
  email: string;
  dob: string;
  gender: '' | 'MALE' | 'FEMALE';
}

function EditForm({ profile, onDone }: { profile: PortalProfile; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, watch, setValue, formState } = useForm<EditValues>({
    defaultValues: {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      email: profile.email ?? '',
      dob: profile.dob ?? '',
      gender: (profile.gender as '' | 'MALE' | 'FEMALE') ?? '',
    },
  });
  const gender = watch('gender');

  const save = useMutation({
    mutationFn: async (values: EditValues) => {
      const body: Record<string, unknown> = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim(),
      };
      if (values.dob) body.dob = values.dob;
      if (values.gender) body.gender = values.gender;
      const res = await api.post<PortalProfile>('/portal/me/profile', body);
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['portal-profile'], data);
      void queryClient.invalidateQueries({ queryKey: ['portal-me'] });
      toast.success('Profil yangilandi');
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <SectionCard title="Shaxsiy ma'lumotlarni tahrirlash">
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ism" error={formState.errors.firstName?.message}>
            <input
              {...register('firstName', { required: 'Ismni kiriting' })}
              className="h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand"
              placeholder="Ism"
            />
          </Field>
          <Field label="Familiya" error={formState.errors.lastName?.message}>
            <input
              {...register('lastName', { required: 'Familiyani kiriting' })}
              className="h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand"
              placeholder="Familiya"
            />
          </Field>
        </div>

        <Field label="Tug‘ilgan sana">
          <input
            type="date"
            {...register('dob')}
            className="h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand"
          />
        </Field>

        <Field label="Jins">
          <div className="flex gap-2">
            {(['MALE', 'FEMALE'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setValue('gender', gender === g ? '' : g)}
                className={`h-11 flex-1 rounded-xl border text-sm font-medium transition ${
                  gender === g
                    ? 'border-brand bg-brand-light text-brand-dark'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {GENDER_LABEL[g]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Email" error={formState.errors.email?.message}>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              {...register('email', {
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email noto‘g‘ri' },
              })}
              className="h-12 w-full rounded-xl border border-slate-300 pl-9 pr-3 outline-none focus:border-brand"
              placeholder="email@example.com"
            />
          </div>
        </Field>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onDone}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            Bekor qilish
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {save.isPending ? <Spinner className="h-5 w-5 text-white" /> : <Check className="h-4 w-4" />}
            Saqlash
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

function TelegramCard({ profile }: { profile: PortalProfile }) {
  const queryClient = useQueryClient();
  const { telegram } = profile;

  const linkMut = useMutation({
    mutationFn: () => api.post<PortalTelegramLinkToken>('/portal/me/telegram/link').then((r) => r.data),
    onSuccess: (data) => {
      if (data.deepLink) {
        window.open(data.deepLink, '_blank', 'noopener');
        toast.success('Telegram ochildi — botда "Start" tugmasini bosing');
      } else {
        toast.error('Telegram bot hozircha sozlanmagan');
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unlinkMut = useMutation({
    mutationFn: () => api.post('/portal/me/telegram/unlink'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portal-profile'] });
      toast.success('Telegram uzildi');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <SectionCard title="Telegram">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
          <Send className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          {telegram.linked ? (
            <>
              <p className="flex items-center gap-1.5 font-medium text-slate-900">
                Ulangan
                <BadgeCheck className="h-4 w-4 text-brand" />
              </p>
              <p className="text-sm text-slate-500">
                {telegram.username ? `@${telegram.username}` : 'Telegram akkaunti'}
                {' · '}botда qabullar, natijalar va hujjatlarni oling
              </p>
              <button
                type="button"
                onClick={() => unlinkMut.mutate()}
                disabled={unlinkMut.isPending}
                className="mt-3 h-9 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Uzish
              </button>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-900">Telegram’ni ulang</p>
              <p className="text-sm text-slate-500">
                Qabullar, tahlil natijalari, hujjatlar va navbat holatini to‘g‘ridan-to‘g‘ri
                Telegram botда oling.
              </p>
              <button
                type="button"
                onClick={() => linkMut.mutate()}
                disabled={linkMut.isPending || !telegram.enabled}
                className="mt-3 flex h-10 items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {linkMut.isPending ? (
                  <Spinner className="h-4 w-4 text-white" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Telegram’ni ulash
              </button>
              {!telegram.enabled && (
                <p className="mt-2 text-xs text-slate-400">
                  Telegram bot hozircha sozlanmagan.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

const PREF_ITEMS: Array<{ key: keyof PortalProfile['prefs']; label: string; desc: string }> = [
  { key: 'appointments', label: 'Qabul eslatmalari', desc: 'Qabuldan oldin eslatma' },
  { key: 'results', label: 'Tahlil natijalari', desc: 'Natija tayyor bo‘lganda' },
  { key: 'payments', label: 'To‘lov cheklari', desc: 'To‘lov amalga oshganda' },
  { key: 'promos', label: 'Yangilik va aksiyalar', desc: 'Klinika xabarlari' },
];

function NotificationPrefs({ profile }: { profile: PortalProfile }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Partial<PortalProfile['prefs']>) => {
      const body: Record<string, unknown> = {};
      if (patch.appointments !== undefined) body.notifyAppointments = patch.appointments;
      if (patch.results !== undefined) body.notifyResults = patch.results;
      if (patch.payments !== undefined) body.notifyPayments = patch.payments;
      if (patch.promos !== undefined) body.notifyPromos = patch.promos;
      return api.post<PortalProfile>('/portal/me/profile', body).then((r) => r.data);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['portal-profile'], data);
      setPending(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setPending(null);
    },
  });

  return (
    <SectionCard
      title="Bildirishnoma sozlamalari"
      action={<Bell className="h-4 w-4 text-slate-400" />}
    >
      <ul className="divide-y divide-slate-100">
        {PREF_ITEMS.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-medium text-slate-800">{item.label}</p>
              <p className="text-sm text-slate-500">{item.desc}</p>
            </div>
            <Toggle
              checked={profile.prefs[item.key]}
              disabled={pending === item.key}
              onChange={(v) => {
                setPending(item.key);
                save.mutate({ [item.key]: v });
              }}
            />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-brand' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function LogoutButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = useSession((s) => s.logout);
  return (
    <button
      type="button"
      onClick={() => {
        logout();
        queryClient.clear();
        toast.success('Tizimdan chiqdingiz');
        router.push('/');
      }}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 font-semibold text-red-600 transition hover:bg-red-50"
    >
      <LogOut className="h-4 w-4" />
      Tizimdan chiqish
    </button>
  );
}
