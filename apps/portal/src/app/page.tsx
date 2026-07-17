'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarCheck2, ChevronRight, FlaskConical, ReceiptText } from 'lucide-react';
import { normalizePhone } from '@avishifo/shared';
import { api } from '@/lib/api';
import type { PortalPatientCard } from '@/lib/types';
import { useSession } from '@/stores/session';
import { PhoneInput } from '@/components/phone-input';
import { SectionCard } from '@/components/section-card';

const FEATURES = [
  {
    icon: CalendarCheck2,
    title: 'Onlayn yozilish',
    text: "Navbatsiz — o'zingizga qulay kun va vaqtni tanlang",
  },
  {
    icon: FlaskConical,
    title: 'Tahlil natijalari',
    text: 'Laboratoriya natijalarini telefoningizda ko‘ring',
  },
  {
    icon: ReceiptText,
    title: 'Hisoblar',
    text: 'To‘lovlar tarixi va hisob-fakturalar bir joyda',
  },
] as const;

export default function LandingPage() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [phoneError, setPhoneError] = useState(false);

  const myCards = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => api.get<PortalPatientCard[]>('/portal/me').then((r) => r.data),
    enabled: status === 'authed',
  });

  const handleStart = () => {
    const normalized = normalizePhone(phoneDisplay);
    if (normalized === null) {
      setPhoneError(true);
      return;
    }
    setPhoneError(false);
    router.push(`/login?phone=${encodeURIComponent(normalized)}&next=${encodeURIComponent('/me')}`);
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="rounded-3xl bg-gradient-to-br from-brand to-brand-dark px-5 py-8 text-white shadow-lg">
        <h1 className="text-3xl font-bold leading-tight">Shifokorga onlayn yoziling</h1>
        <p className="mt-2 text-white/85">
          Klinikaga qo&apos;ng&apos;iroq qilmasdan qabulga yoziling, tahlil natijalari va
          hisoblaringizni kuzatib boring.
        </p>
        {status !== 'authed' && (
          <div className="mt-5 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <PhoneInput
                value={phoneDisplay}
                onChange={(v) => {
                  setPhoneDisplay(v);
                  setPhoneError(false);
                }}
                invalid={phoneError}
              />
              <button
                type="button"
                onClick={handleStart}
                className="h-12 shrink-0 rounded-xl bg-white px-6 font-semibold text-brand-dark transition hover:bg-brand-light"
              >
                Boshlash
              </button>
            </div>
            {phoneError && (
              <p className="text-sm text-red-100">Telefon raqamni to&apos;liq kiriting</p>
            )}
          </div>
        )}
        {status === 'authed' && (
          <Link
            href="/me"
            className="mt-5 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 font-semibold text-brand-dark transition hover:bg-brand-light"
          >
            Kabinetga o&apos;tish
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </section>

      {/* Features */}
      <div className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <SectionCard key={f.title}>
            <f.icon className="h-6 w-6 text-brand" />
            <h3 className="mt-2 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{f.text}</p>
          </SectionCard>
        ))}
      </div>

      {/* Clinic selection info */}
      <SectionCard title="Klinikani tanlang">
        {status === 'authed' && myCards.data !== undefined && myCards.data.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {myCards.data.map((card) => (
              <li key={`${card.clinicId}:${card.patientId}`}>
                <Link
                  href={`/c/${card.clinicId}`}
                  className="flex items-center justify-between gap-3 py-3 transition hover:bg-slate-50"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-light text-brand">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <span className="font-medium">{card.clinicName}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-start gap-3 text-sm text-slate-600">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand">
              <Building2 className="h-5 w-5" />
            </span>
            <p>
              Qabulga yozilish uchun klinikangiz yuborgan havolani oching — masalan{' '}
              <span className="font-mono text-slate-800">avishifo.uz/c/&lt;klinika&gt;</span>. Havola
              klinikaning SMS xabarlarida va ijtimoiy tarmoqlarida bo&apos;ladi.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
