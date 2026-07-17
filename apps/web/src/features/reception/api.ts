import type {
  AppointmentStatus,
  ChangeAppointmentStatusInput,
  CreateAppointmentInput,
  CreatePatientInput,
  EnqueueInput,
  QueueTicketPayload,
  TicketPriority,
} from '@avishifo/shared';
import { api } from '@/lib/api-client';
import { tashkentToUtcIso, todayTashkent } from '@/lib/dates';

/** GET /appointments row (subset used by the reception dashboard). */
export interface ReceptionAppointment {
  id: string;
  branchId: string;
  patientId: string;
  doctorUserId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  note: string | null;
  cancelledReason: string | null;
  patient: { id: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string };
  services: Array<{ id: string; serviceId: string; code: string; durationMin: number }>;
}

export interface PatientHit {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

/** ApiError.details entry for a 409 DUPLICATE_PATIENT. */
export interface DuplicateCandidate {
  id: string;
  mrn: string;
  fullName: string;
  phone: string | null;
}

export interface DoctorOption {
  id: string;
  fullName: string;
  specialty: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function fetchTodayAppointments(branchId: string): Promise<ReceptionAppointment[]> {
  const from = tashkentToUtcIso(todayTashkent(), '00:00');
  const to = new Date(new Date(from).getTime() + DAY_MS).toISOString();
  const res = await api.get<ReceptionAppointment[]>('/appointments', {
    from,
    to,
    branchId,
    limit: 100,
  });
  return res.data;
}

export async function changeAppointmentStatus(
  id: string,
  body: ChangeAppointmentStatusInput,
): Promise<ReceptionAppointment> {
  return (await api.post<ReceptionAppointment>(`/appointments/${id}/status`, body)).data;
}

export async function fetchQueueSnapshot(branchId: string): Promise<QueueTicketPayload[]> {
  const res = await api.get<{ branchId: string; tickets: QueueTicketPayload[] }>(
    '/queues/snapshot',
    { branchId },
  );
  return res.data.tickets;
}

export async function enqueueTicket(body: EnqueueInput): Promise<QueueTicketPayload> {
  return (await api.post<QueueTicketPayload>('/queues/enqueue', body)).data;
}

export async function setTicketPriority(
  ticketId: string,
  priority: TicketPriority,
): Promise<QueueTicketPayload> {
  return (await api.patch<QueueTicketPayload>(`/queues/tickets/${ticketId}/priority`, { priority }))
    .data;
}

export async function transferTicket(
  ticketId: string,
  targetDoctorUserId: string,
): Promise<QueueTicketPayload> {
  return (
    await api.patch<QueueTicketPayload>(`/queues/tickets/${ticketId}/transfer`, {
      targetDoctorUserId,
    })
  ).data;
}

export async function skipTicket(ticketId: string): Promise<QueueTicketPayload> {
  return (await api.post<QueueTicketPayload>(`/queues/tickets/${ticketId}/skip`)).data;
}

export async function createPatient(
  body: CreatePatientInput,
  force: boolean,
): Promise<PatientHit> {
  return (await api.post<PatientHit>('/patients', body, force ? { force: 'true' } : undefined))
    .data;
}

export async function searchPatients(search: string): Promise<PatientHit[]> {
  return (await api.get<PatientHit[]>('/patients', { search, limit: 8 })).data;
}

export async function fetchDoctors(): Promise<DoctorOption[]> {
  return (await api.get<DoctorOption[]>('/staff', { role: 'DOCTOR', limit: 100 })).data;
}

/**
 * Walk-in: one POST creates the appointment AND enqueues it server-side
 * (always at NORMAL priority). A non-normal priority is applied afterwards by
 * locating the fresh WAITING ticket in the snapshot and patching it; failures
 * of that secondary step are swallowed — the walk-in itself succeeded.
 */
export async function createWalkIn(
  input: CreateAppointmentInput,
  priority: TicketPriority,
): Promise<void> {
  await api.post<ReceptionAppointment>('/appointments', { ...input, walkIn: true });
  if (priority === 'NORMAL') return;
  try {
    const tickets = await fetchQueueSnapshot(input.branchId);
    const ticket = tickets
      .filter(
        (t) =>
          t.patientId === input.patientId &&
          t.doctorUserId === input.doctorUserId &&
          t.status === 'WAITING',
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (ticket) await setTicketPriority(ticket.id, priority);
  } catch {
    // Priority upgrade is best-effort; the ticket exists either way.
  }
}
