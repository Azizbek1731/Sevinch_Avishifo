'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock,
  MapPin,
  Stethoscope,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatUZS, portalBookSchema, type PortalBookInput } from '@avishifo/shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import type {
  PortalBookedAppointment,
  PortalClinicInfo,
  PortalPatientCard,
  PortalSlot,
} from '@/lib/types';
import { formatDateTime, formatTime, nextDays } from '@/lib/dates';
import { useSession } from '@/stores/session';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { OtpLoginForm } from '@/components/otp-login-form';
import { PageLoader, Spinner } from '@/components/spinner';
import { SectionCard } from '@/components/section-card';

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  1: 'Filialni tanlang',
  2: 'Shifokorni tanlang',
  3: 'Kun va vaqtni tanlang',
  4: 'Yozilishni tasdiqlang',
};

interface BookPayload extends PortalBookInput {
  firstName?: string;
  lastName?: string;
}

export default function BookingPage() {
  const { clinicId } = useParams<{ clinicId: string }>();
  const queryClient = useQueryClient();
  const sessionStatus = useSession((s) => s.status);
  const login = useSession((s) => s.login);

  const [step, setStep] = useState<Step>(1);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [doctorUserId, setDoctorUserId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<PortalSlot | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [booked, setBooked] = useState<PortalBookedAppointment | null>(null);

  const clinicQ = useQuery({
    queryKey: ['portal-clinic', clinicId],
    queryFn: () => api.get<PortalClinicInfo>(`/portal/clinics/${clinicId}`).then((r) => r.data),
    enabled: typeof clinicId === 'string' && clinicId !== '',
  });

  const slotsQ = useQuery({
    queryKey: ['portal-slots', clinicId, branchId, doctorUserId, date],
    queryFn: () =>
      api
        .get<PortalSlot[]>('/portal/slots', { clinicId, branchId, doctorUserId, date })
        .then((r) => r.data),
    enabled: branchId !== null && doctorUserId !== null && date !== null,
  });

  const meQ = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => api.get<PortalPatientCard[]>('/portal/me').then((r) => r.data),
    enabled: sessionStatus === 'authed' && step === 4,
  });

  /** First booking ever → the clinic needs the patient's name. */
  const needName = sessionStatus === 'authed' && meQ.data !== undefined && meQ.data.length === 0;

  const book = useMutation({
    mutationFn: async () => {
      if (branchId === null || doctorUserId === null || slot === null) {
        throw new Error('incomplete');
      }
      const base = portalBookSchema.parse({
        branchId,
        doctorUserId,
        serviceId: serviceId === '' ? undefined : serviceId,
        startAt: slot.startAt,
      });
      const payload: BookPayload = needName
        ? { ...base, firstName: firstName.trim(), lastName: lastName.trim() }
        : base;
      return api.post<PortalBookedAppointment>('/portal/book', payload).then((r) => r.data);
    },
    onSuccess: (appointment) => {
      setBooked(appointment);
      void queryClient.invalidateQueries({ queryKey: ['portal-appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['portal-me'] });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      if (error instanceof ApiError && error.code === 'SLOT_TAKEN') {
        setSlot(null);
        setStep(3);
        void queryClient.invalidateQueries({ queryKey: ['portal-slots'] });
      }
    },
  });

  if (clinicQ.isPending) return <PageLoader />;
  if (clinicQ.isError) {
    return (
      <EmptyState
        icon={<Building2 className="h-10 w-10" />}
        title="Klinika topilmadi"
        description={errorMessage(clinicQ.error)}
      />
    );
  }

  const { clinic, branches, doctors, services } = clinicQ.data;
  const branch = branches.find((b) => b.id === branchId);
  const doctor = doctors.find((d) => d.userId === doctorUserId);
  const service = services.find((s) => s.id === serviceId);

  /* ---------- Success screen ---------- */
  if (booked !== null && slot !== null) {
    return (
      <div className="mx-auto max-w-md text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
        <h1 className="mt-3 text-2xl font-bold">Qabulga yozildingiz!</h1>
        <p className="mt-1 text-slate-500">Qabul vaqtidan 15 daqiqa oldin kelishingizni so&apos;raymiz.</p>
        <SectionCard className="mt-5 text-left">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Klinika</dt>
              <dd className="font-medium">{clinic.name}</dd>
            </div>
            {branch !== undefined && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Filial</dt>
                <dd className="text-right font-medium">
                  {branch.name}
                  {branch.address !== null && branch.address !== '' && (
                    <span className="block text-xs font-normal text-slate-500">{branch.address}</span>
                  )}
                </dd>
              </div>
            )}
            {doctor !== undefined && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Shifokor</dt>
                <dd className="font-medium">{doctor.fullName}</dd>
              </div>
            )}
            {service !== undefined && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Xizmat</dt>
                <dd className="font-medium">
                  {service.name.uz} · {formatUZS(service.price)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Vaqt</dt>
              <dd className="font-semibold text-brand-dark">{formatDateTime(slot.startAt)}</dd>
            </div>
          </dl>
        </SectionCard>
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/me/appointments"
            className="flex h-12 items-center justify-center rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark"
          >
            Qabullarim
          </Link>
          <Link
            href={`/c/${clinicId}`}
            className="flex h-12 items-center justify-center rounded-xl border border-slate-300 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Klinika sahifasi
          </Link>
        </div>
      </div>
    );
  }

  /* ---------- Wizard ---------- */
  const goBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  };

  return (
    <div className="space-y-4">
      {/* Header + progress */}
      <div className="flex items-center gap-2">
        {step > 1 ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Orqaga"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <Link
            href={`/c/${clinicId}`}
            aria-label="Orqaga"
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        )}
        <div>
          <p className="text-xs text-slate-400">
            {clinic.name} · {step}/4-qadam
          </p>
          <h1 className="text-lg font-bold leading-tight">{STEP_TITLES[step]}</h1>
        </div>
      </div>
      <div className="flex gap-1.5">
        {([1, 2, 3, 4] as const).map((s) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-brand' : 'bg-slate-200'}`}
          />
        ))}
      </div>

      {/* Step 1: branch */}
      {step === 1 && (
        <div className="space-y-2">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setBranchId(b.id);
                setDate(null);
                setSlot(null);
                setStep(2);
              }}
              className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-brand ${
                branchId === b.id ? 'border-brand ring-2 ring-brand/20' : 'border-slate-200'
              }`}
            >
              <p className="font-semibold">{b.name}</p>
              {b.address !== null && b.address !== '' && (
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                  <MapPin className="h-4 w-4 shrink-0" />
                  {b.address}
                </p>
              )}
            </button>
          ))}
          {branches.length === 0 && (
            <EmptyState title="Filiallar topilmadi" description="Keyinroq urinib ko'ring" />
          )}
        </div>
      )}

      {/* Step 2: doctor */}
      {step === 2 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {doctors.map((d) => (
            <button
              key={d.userId}
              type="button"
              onClick={() => {
                setDoctorUserId(d.userId);
                setDate(null);
                setSlot(null);
                setStep(3);
              }}
              className={`flex flex-col items-center rounded-2xl border bg-white p-4 text-center shadow-sm transition hover:border-brand ${
                doctorUserId === d.userId ? 'border-brand ring-2 ring-brand/20' : 'border-slate-200'
              }`}
            >
              <Avatar name={d.fullName} photoUrl={d.photoUrl} />
              <p className="mt-2 text-sm font-semibold leading-snug">{d.fullName}</p>
              {d.specialty !== null && d.specialty !== '' && (
                <p className="mt-0.5 text-xs text-slate-500">{d.specialty}</p>
              )}
            </button>
          ))}
          {doctors.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                icon={<Stethoscope className="h-10 w-10" />}
                title="Shifokorlar topilmadi"
              />
            </div>
          )}
        </div>
      )}

      {/* Step 3: date + time */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {nextDays(14).map((day) => (
              <button
                key={day.date}
                type="button"
                onClick={() => {
                  setDate(day.date);
                  setSlot(null);
                }}
                className={`flex w-16 shrink-0 flex-col items-center rounded-xl border py-2 transition ${
                  date === day.date
                    ? 'border-brand bg-brand text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-brand'
                }`}
              >
                <span className={`text-[11px] ${date === day.date ? 'text-white/80' : 'text-slate-400'}`}>
                  {day.isToday ? 'bugun' : day.weekday.slice(0, 3)}
                </span>
                <span className="text-sm font-semibold">{day.label}</span>
              </button>
            ))}
          </div>

          {date === null && (
            <EmptyState
              icon={<CalendarDays className="h-10 w-10" />}
              title="Kunni tanlang"
              description="Bo'sh vaqtlarni ko'rish uchun yuqoridan kunni tanlang"
            />
          )}
          {date !== null && slotsQ.isPending && <PageLoader />}
          {date !== null && slotsQ.isError && (
            <EmptyState title="Vaqtlarni yuklab bo'lmadi" description={errorMessage(slotsQ.error)} />
          )}
          {date !== null && slotsQ.data !== undefined && slotsQ.data.length === 0 && (
            <EmptyState
              icon={<Clock className="h-10 w-10" />}
              title="Bu kunga bo'sh vaqt yo'q"
              description="Boshqa kunni tanlab ko'ring"
            />
          )}
          {date !== null && slotsQ.data !== undefined && slotsQ.data.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {slotsQ.data.map((s) => (
                <button
                  key={s.startAt}
                  type="button"
                  onClick={() => {
                    setSlot(s);
                    setStep(4);
                  }}
                  className={`min-h-11 rounded-xl border text-sm font-semibold transition ${
                    slot?.startAt === s.startAt
                      ? 'border-brand bg-brand text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-brand'
                  }`}
                >
                  {formatTime(s.startAt)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 4: confirm */}
      {step === 4 && slot !== null && (
        <div className="space-y-4">
          <SectionCard>
            <dl className="space-y-3 text-sm">
              {branch !== undefined && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Filial</dt>
                  <dd className="font-medium">{branch.name}</dd>
                </div>
              )}
              {doctor !== undefined && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Shifokor</dt>
                  <dd className="font-medium">{doctor.fullName}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Vaqt</dt>
                <dd className="font-semibold text-brand-dark">{formatDateTime(slot.startAt)}</dd>
              </div>
            </dl>
          </SectionCard>

          {services.length > 0 && (
            <SectionCard title="Xizmat (ixtiyoriy)">
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="">Tanlanmagan</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name.uz} — {formatUZS(s.price)}
                  </option>
                ))}
              </select>
            </SectionCard>
          )}

          {sessionStatus !== 'authed' ? (
            <SectionCard title="Davom etish uchun raqamingizni tasdiqlang">
              <OtpLoginForm onSuccess={(token, phone) => login(phone, token)} />
            </SectionCard>
          ) : meQ.isPending ? (
            <PageLoader />
          ) : (
            <>
              {needName && (
                <SectionCard title="O'zingizni tanishtiring">
                  <p className="mb-3 text-sm text-slate-500">
                    Bu klinikaga birinchi marta yozilyapsiz — ism va familiyangizni kiriting
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <input
                        value={firstName}
                        onChange={(e) => {
                          setFirstName(e.target.value);
                          setNameError(false);
                        }}
                        placeholder="Ismingiz"
                        autoComplete="given-name"
                        className={`h-12 w-full rounded-xl border bg-white px-4 text-base outline-none transition focus:ring-2 ${
                          nameError && firstName.trim() === ''
                            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                            : 'border-slate-300 focus:border-brand focus:ring-brand/20'
                        }`}
                      />
                    </div>
                    <div>
                      <input
                        value={lastName}
                        onChange={(e) => {
                          setLastName(e.target.value);
                          setNameError(false);
                        }}
                        placeholder="Familiyangiz"
                        autoComplete="family-name"
                        className={`h-12 w-full rounded-xl border bg-white px-4 text-base outline-none transition focus:ring-2 ${
                          nameError && lastName.trim() === ''
                            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
                            : 'border-slate-300 focus:border-brand focus:ring-brand/20'
                        }`}
                      />
                    </div>
                  </div>
                  {nameError && (
                    <p className="mt-2 text-sm text-red-600">Ism va familiyani kiriting</p>
                  )}
                </SectionCard>
              )}
              <button
                type="button"
                disabled={book.isPending}
                onClick={() => {
                  if (needName && (firstName.trim() === '' || lastName.trim() === '')) {
                    setNameError(true);
                    return;
                  }
                  book.mutate();
                }}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
              >
                {book.isPending ? <Spinner className="h-5 w-5 text-white" /> : 'Yozilishni tasdiqlash'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
