import { z } from 'zod';
import { idSchema, moneySchema, paginationQuerySchema } from './common';

/** Care type chosen when the patient is registered for treatment. */
export const CareType = { AMBULATORY: 'AMBULATORY', INPATIENT: 'INPATIENT' } as const;
export type CareType = (typeof CareType)[keyof typeof CareType];

export const admissionOutcomeSchema = z.enum([
  'RECOVERED',
  'IMPROVED',
  'UNCHANGED',
  'WORSE',
  'TRANSFERRED',
  'DIED',
]);
export type AdmissionOutcome = z.infer<typeof admissionOutcomeSchema>;

export const orderScheduleSchema = z.enum(['DAILY', 'EVERY_OTHER_DAY', 'ONCE']);
export type OrderSchedule = z.infer<typeof orderScheduleSchema>;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const roomRateSchema = moneySchema.refine((value) => value.split('.')[0]!.replace(/^0+/, '').length <= 12, 'Room rate is too large');

export const admitPatientSchema = z.object({
  patientId: idSchema,
  department: z.string().trim().max(120).optional(),
  ward: z.string().trim().max(40).optional(),
  bed: z.string().trim().max(40).optional(),
  dailyRoomRate: roomRateSchema.optional(),
  attendingDoctorUserId: idSchema.optional(),
  admittedAt: z.string().datetime().optional(),
  referredBy: z.string().trim().max(200).optional(),
  referralDiagnosis: z.string().trim().max(500).optional(),
  admissionDiagnosis: z.string().trim().max(500).optional(),
  firstTimeThisYear: z.coerce.boolean().optional(),
});
export type AdmitPatientInput = z.infer<typeof admitPatientSchema>;

/** The 003 narrative fields, saved as the doctor fills them in. */
export const updateAdmissionSchema = z.object({
  department: z.string().trim().max(120).optional(),
  ward: z.string().trim().max(40).optional(),
  bed: z.string().trim().max(40).optional(),
  dailyRoomRate: roomRateSchema.optional(),
  attendingDoctorUserId: idSchema.nullable().optional(),
  referredBy: z.string().trim().max(200).optional(),
  referralDiagnosis: z.string().trim().max(500).optional(),
  admissionDiagnosis: z.string().trim().max(500).optional(),
  clinicalDiagnosis: z.string().trim().max(500).optional(),
  clinicalDiagnosisAt: dateOnly.optional(),
  finalDiagnosisMain: z.string().trim().max(500).optional(),
  finalDiagnosisComplication: z.string().trim().max(500).optional(),
  finalDiagnosisComorbid: z.string().trim().max(500).optional(),
  firstTimeThisYear: z.coerce.boolean().optional(),
  complaints: z.string().max(4000).optional(),
  anamnesisMorbi: z.string().max(8000).optional(),
  anamnesisVitae: z.string().max(8000).optional(),
  objectiveStatus: z.string().max(8000).optional(),
  preliminaryDiagnosis: z.string().trim().max(500).optional(),
  treatmentPlan: z.string().max(4000).optional(),
  epicrisis: z.string().max(8000).optional(),
});
export type UpdateAdmissionInput = z.infer<typeof updateAdmissionSchema>;

export const dischargeSchema = z.object({
  outcome: admissionOutcomeSchema,
  finalDiagnosisMain: z.string().trim().min(1).max(500),
  finalDiagnosisComplication: z.string().trim().max(500).optional(),
  finalDiagnosisComorbid: z.string().trim().max(500).optional(),
  epicrisis: z.string().max(8000).optional(),
  dischargedAt: z.string().datetime().optional(),
  /**
   * Close the stay over whatever is still outstanding — services not yet
   * invoiced, money not yet paid, or both. Needs `admissions.force`.
   *
   * A bed is physical and the paperwork is not: a death, a transfer, or a
   * patient who simply walked out cannot wait for the desk to catch up, and a
   * discharge date recorded days late is a falsified record. Nothing is
   * forgiven — the charges stay billable and the amount owed at that instant is
   * written onto the admission.
   */
  force: z.coerce.boolean().optional(),
  /** @deprecated Older clients sent this; `force` covers it. */
  debtAcknowledged: z.coerce.boolean().optional(),
});
export type DischargeInput = z.infer<typeof dischargeSchema>;

export const createOrderSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  serviceId: idSchema,
  schedule: orderScheduleSchema,
  startDate: dateOnly,
  /** Planned treatment DAYS — "5 kun davomida" is 5, whatever the schedule. */
  timesPlanned: z.coerce.number().int().min(1).max(120),
  /** Doses within each day — "kunida 2 mahal" is 2. */
  timesPerDay: z.coerce.number().int().min(1).max(6).default(1),
  note: z.string().trim().max(300).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * Marking one planned day off. SKIPPED is deliberately a stored answer rather
 * than an absence: "the patient refused it" and "nobody wrote it down" must
 * not look the same on the treatment sheet.
 */
export const markAdministrationSchema = z.object({
  orderId: idSchema,
  date: dateOnly,
  /** Which dose of the day, 1-based. Omitted means the only (or first) one. */
  slot: z.coerce.number().int().min(1).max(6).default(1),
  status: z.enum(['GIVEN', 'SKIPPED']),
});
export type MarkAdministrationInput = z.infer<typeof markAdministrationSchema>;

export const dailyNoteSchema = z.object({
  date: dateOnly,
  condition: z.string().trim().min(1).max(4000),
  temperatureC: z.coerce.number().min(30).max(45).optional(),
  pulseBpm: z.coerce.number().int().min(20).max(250).optional(),
  bpSystolic: z.coerce.number().int().min(40).max(300).optional(),
  bpDiastolic: z.coerce.number().int().min(20).max(200).optional(),
  note: z.string().max(4000).optional(),
});
export type DailyNoteInput = z.infer<typeof dailyNoteSchema>;

export const admissionQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'DISCHARGED']).optional(),
  patientId: idSchema.optional(),
});
export type AdmissionQueryInput = z.infer<typeof admissionQuerySchema>;

/** A charge written directly (an outpatient consultation service). */
export const addChargeSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  patientId: idSchema,
  serviceId: idSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  date: dateOnly,
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  unitPrice: moneySchema.optional(),
  visitId: idSchema.optional(),
  admissionId: idSchema.optional(),
});
export type AddChargeInput = z.infer<typeof addChargeSchema>;

/**
 * Billing a selection of what the patient owes. The desk ticks the lines the
 * patient is paying for now — all of them, or some — and the rest stay
 * pending. This is the shape both wards and reception actually work in.
 */
export const invoiceChargesSchema = z.object({
  chargeIds: z.array(idSchema).min(1).max(200),
  idempotencyKey: z.string().uuid().optional(),
});
export type InvoiceChargesInput = z.infer<typeof invoiceChargesSchema>;

export const chargeQuerySchema = z.object({
  patientId: idSchema,
  admissionId: idSchema.optional(),
  status: z.enum(['PENDING', 'INVOICED', 'CANCELLED']).optional(),
});
export type ChargeQueryInput = z.infer<typeof chargeQuerySchema>;
