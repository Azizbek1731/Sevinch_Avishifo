'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { uz, ru, enUS } from 'date-fns/locale';
import { CalendarIcon, CalendarX2, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react';
import type { AppointmentStatus } from '@avishifo/shared';
import { formatTz, tashkentToUtcIso, todayTashkent } from '@/lib/dates';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Appointment } from '../api';
import { useAppointments, useAppointmentsLive, useDoctors } from '../hooks';
import { CalendarGrid, type CalendarColumn } from './calendar-grid';
import { AppointmentDetailDialog } from './appointment-detail-dialog';
import {
  AppointmentFormDialog,
  type AppointmentPrefill,
} from './appointment-form-dialog';
import { AppointmentReasonDialog } from './appointment-reason-dialog';
import { RecurringDialog } from './recurring-dialog';

type CalendarView = 'day' | 'week';

const DATE_LOCALES = { uz, ru, en: enUS } as const;
const ALL_DOCTORS = 'all';

function weekDatesOf(dateStr: string): string[] {
  const monday = startOfWeek(parseISO(dateStr), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), 'yyyy-MM-dd'));
}

function shiftDate(dateStr: string, days: number): string {
  return format(addDays(parseISO(dateStr), days), 'yyyy-MM-dd');
}

export function AppointmentsCalendar() {
  const t = useTranslations('appointments');
  const locale = useLocale() as keyof typeof DATE_LOCALES;
  const dateLocale = DATE_LOCALES[locale] ?? uz;

  const user = useAuthStore((s) => s.user);
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const canWrite = user?.permissions.includes('appointments.write') ?? false;

  const [view, setView] = useState<CalendarView>('day');
  const [dateStr, setDateStr] = useState<string>(todayTashkent());
  const [doctorFilter, setDoctorFilter] = useState<string>(ALL_DOCTORS);
  const [dateOpen, setDateOpen] = useState(false);

  // Dialog state
  const [detailAppointmentId, setDetailAppointmentId] = useState<string | null>(null);
  const [formState, setFormState] = useState<{
    mode: 'create' | 'edit';
    appointment?: Appointment | null;
    prefill?: AppointmentPrefill | null;
  } | null>(null);
  const [reasonState, setReasonState] = useState<{
    appointment: Appointment;
    status: AppointmentStatus;
  } | null>(null);
  const [recurringAppointment, setRecurringAppointment] = useState<Appointment | null>(null);

  const { data: doctors, isLoading: doctorsLoading } = useDoctors();

  /** Week view always renders a single doctor; default to the first one. */
  const weekDoctorId =
    doctorFilter !== ALL_DOCTORS ? doctorFilter : (doctors?.[0]?.id ?? '');

  const weekDates = useMemo(() => weekDatesOf(dateStr), [dateStr]);

  const { from, to } = useMemo(() => {
    if (view === 'day') {
      return {
        from: tashkentToUtcIso(dateStr, '00:00'),
        to: tashkentToUtcIso(shiftDate(dateStr, 1), '00:00'),
      };
    }
    return {
      from: tashkentToUtcIso(weekDates[0] ?? dateStr, '00:00'),
      to: tashkentToUtcIso(shiftDate(weekDates[6] ?? dateStr, 1), '00:00'),
    };
  }, [view, dateStr, weekDates]);

  const listParams = useMemo(
    () => ({
      from,
      to,
      branchId: activeBranchId ?? undefined,
      doctorUserId:
        view === 'week'
          ? weekDoctorId || undefined
          : doctorFilter !== ALL_DOCTORS
            ? doctorFilter
            : undefined,
    }),
    [from, to, activeBranchId, view, weekDoctorId, doctorFilter],
  );

  const { data: appointments, isLoading: appointmentsLoading } = useAppointments(
    listParams,
    Boolean(activeBranchId) && (view === 'day' || Boolean(weekDoctorId)),
  );

  useAppointmentsLive();

  const today = todayTashkent();

  const columns = useMemo<CalendarColumn[]>(() => {
    const list = appointments ?? [];
    if (view === 'day') {
      const visibleDoctors =
        doctorFilter === ALL_DOCTORS
          ? (doctors ?? [])
          : (doctors ?? []).filter((d) => d.id === doctorFilter);
      return visibleDoctors.map((d) => ({
        key: d.id,
        label: d.fullName,
        sublabel: format(parseISO(dateStr), 'dd.MM', { locale: dateLocale }),
        date: dateStr,
        doctorUserId: d.id,
        isToday: dateStr === today,
        appointments: list.filter((a) => a.doctorUserId === d.id),
      }));
    }
    const weekDoctor = (doctors ?? []).find((d) => d.id === weekDoctorId);
    return weekDates.map((ds) => ({
      key: ds,
      label: format(parseISO(ds), 'EEE', { locale: dateLocale }),
      sublabel: format(parseISO(ds), 'dd.MM', { locale: dateLocale }),
      date: ds,
      doctorUserId: weekDoctor?.id ?? '',
      isToday: ds === today,
      appointments: list.filter((a) => formatTz(a.startAt, 'yyyy-MM-dd') === ds),
    }));
  }, [view, appointments, doctors, doctorFilter, dateStr, weekDates, weekDoctorId, dateLocale, today]);

  const detailAppointment =
    (appointments ?? []).find((a) => a.id === detailAppointmentId) ?? null;

  const headerLabel =
    view === 'day'
      ? format(parseISO(dateStr), 'd MMMM yyyy, EEEE', { locale: dateLocale })
      : `${format(parseISO(weekDates[0] ?? dateStr), 'd MMM', { locale: dateLocale })} – ${format(
          parseISO(weekDates[6] ?? dateStr),
          'd MMM yyyy',
          { locale: dateLocale },
        )}`;

  const navigate = (direction: -1 | 1) => {
    setDateStr((d) => shiftDate(d, view === 'day' ? direction : direction * 7));
  };

  const openCreate = (prefill?: AppointmentPrefill) => {
    setFormState({ mode: 'create', prefill: prefill ?? { date: dateStr } });
  };

  const loading = doctorsLoading || appointmentsLoading;
  const noDoctors = !doctorsLoading && (doctors ?? []).length === 0;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')}>
        {canWrite ? (
          <Button onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" />
            {t('newAppointment')}
          </Button>
        ) : null}
      </PageHeader>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as CalendarView)}>
          <TabsList>
            <TabsTrigger value="day">{t('views.day')}</TabsTrigger>
            <TabsTrigger value="week">{t('views.week')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label={t('prevPeriod')} onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setDateStr(todayTashkent())}>
            {t('today')}
          </Button>
          <Button variant="outline" size="icon" aria-label={t('nextPeriod')} onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-44 justify-start font-normal">
              <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
              <span className="truncate">{headerLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={parseISO(dateStr)}
              locale={dateLocale}
              onSelect={(d) => {
                if (d) setDateStr(format(d, 'yyyy-MM-dd'));
                setDateOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        <Select value={view === 'week' ? weekDoctorId || undefined : doctorFilter} onValueChange={setDoctorFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t('doctor')} />
          </SelectTrigger>
          <SelectContent>
            {view === 'day' ? (
              <SelectItem value={ALL_DOCTORS}>{t('allDoctors')}</SelectItem>
            ) : null}
            {(doctors ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      ) : noDoctors ? (
        <EmptyState icon={Users} title={t('noDoctors')} description={t('noDoctorsDesc')} />
      ) : columns.length === 0 ? (
        <EmptyState icon={CalendarX2} title={t('noAppointments')} />
      ) : (
        <CalendarGrid
          columns={columns}
          onSlotClick={
            canWrite
              ? (col, time) =>
                  openCreate({ doctorUserId: col.doctorUserId, date: col.date, time })
              : undefined
          }
          onAppointmentClick={(a) => setDetailAppointmentId(a.id)}
        />
      )}

      {/* Dialogs */}
      <AppointmentDetailDialog
        appointment={detailAppointment}
        open={detailAppointment !== null}
        onOpenChange={(o) => {
          if (!o) setDetailAppointmentId(null);
        }}
        onReschedule={(a) => {
          setDetailAppointmentId(null);
          setFormState({ mode: 'edit', appointment: a });
        }}
        onRecurring={(a) => {
          setDetailAppointmentId(null);
          setRecurringAppointment(a);
        }}
        onReason={(a, status) => {
          setDetailAppointmentId(null);
          setReasonState({ appointment: a, status });
        }}
      />

      <AppointmentFormDialog
        open={formState !== null}
        onOpenChange={(o) => {
          if (!o) setFormState(null);
        }}
        mode={formState?.mode ?? 'create'}
        appointment={formState?.appointment ?? null}
        prefill={formState?.prefill ?? null}
      />

      <AppointmentReasonDialog
        open={reasonState !== null}
        onOpenChange={(o) => {
          if (!o) setReasonState(null);
        }}
        appointment={reasonState?.appointment ?? null}
        status={reasonState?.status ?? 'CANCELLED'}
      />

      <RecurringDialog
        open={recurringAppointment !== null}
        onOpenChange={(o) => {
          if (!o) setRecurringAppointment(null);
        }}
        appointment={recurringAppointment}
      />
    </div>
  );
}
