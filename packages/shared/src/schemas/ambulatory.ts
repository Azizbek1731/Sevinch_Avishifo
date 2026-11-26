import { z } from 'zod';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

/** Clinic default when no per-doctor override exists. */
export const AMBULATORY_DEFAULT_LAB_PERCENT = 25;
/** Ozon / gidrokolonoterapiya (DIAG-04 / DIAG-05) referring-doctor share. */
export const AMBULATORY_DEFAULT_THERAPY_PERCENT = 20;

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && !value.trim() ? undefined : value),
    z.string().trim().max(max).optional(),
  );

export const ambulatoryCaseStatusSchema = z.enum(['OPEN', 'CLOSED']);
export type AmbulatoryCaseStatus = z.infer<typeof ambulatoryCaseStatusSchema>;

export const openAmbulatoryCaseSchema = z.object({
  patientId: idSchema,
  /** Doctors open cards for themselves; the desk must pick the doctor. */
  doctorUserId: idSchema.optional(),
  complaint: optionalText(500),
  diagnosis: optionalText(500),
  note: optionalText(1000),
});
export type OpenAmbulatoryCaseInput = z.infer<typeof openAmbulatoryCaseSchema>;

export const updateAmbulatoryCaseSchema = z.object({
  /** Only while no lab work is linked — the share belongs to the doctor at order time. */
  doctorUserId: idSchema.optional(),
  complaint: optionalText(500).nullable(),
  diagnosis: optionalText(500).nullable(),
  note: optionalText(1000).nullable(),
});
export type UpdateAmbulatoryCaseInput = z.infer<typeof updateAmbulatoryCaseSchema>;

export const ambulatoryCaseQuerySchema = paginationQuerySchema.extend({
  status: ambulatoryCaseStatusSchema.optional(),
  patientId: idSchema.optional(),
  doctorUserId: idSchema.optional(),
  /** Card №, patient name or MRN. */
  search: z.string().trim().min(1).max(120).optional(),
  /** Inclusive Tashkent calendar dates of opening. */
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type AmbulatoryCaseQueryInput = z.infer<typeof ambulatoryCaseQuerySchema>;

export const ambulatoryLabOrderSchema = z.object({
  serviceIds: z.array(idSchema).min(1).max(60),
});
export type AmbulatoryLabOrderInput = z.infer<typeof ambulatoryLabOrderSchema>;

export const ambulatoryUziOrderSchema = z.object({
  /** The ultrasound specialist who performs the scan. */
  doctorUserId: idSchema,
  serviceIds: z.array(idSchema).min(1).max(30),
  note: optionalText(500),
});
export type AmbulatoryUziOrderInput = z.infer<typeof ambulatoryUziOrderSchema>;

/** A catalogue service is billed at its current price; a free-text line carries its own. */
export const ambulatoryServiceItemSchema = z
  .object({
    serviceId: idSchema.optional(),
    title: optionalText(200),
    unitPrice: moneySchema
      .refine((value) => /^\d{1,12}(?:\.\d{1,2})?$/.test(value), 'Amount too large')
      .refine((value) => Number(value) > 0, 'Price must be positive')
      .optional(),
    quantity: z.coerce.number().int().min(1).max(99).default(1),
  })
  .refine((item) => Boolean(item.serviceId) || Boolean(item.title && item.unitPrice), {
    message: 'Choose a service or enter a name and price',
  });

export const ambulatoryServiceOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  items: z.array(ambulatoryServiceItemSchema).min(1).max(30),
});
export type AmbulatoryServiceOrderInput = z.infer<typeof ambulatoryServiceOrderSchema>;

export const ambulatoryCommissionQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
    doctorUserId: idSchema.optional(),
    export: z.enum(['xlsx']).optional(),
  })
  .superRefine((value, ctx) => {
    const from = new Date(`${value.from}T00:00:00Z`);
    const to = new Date(`${value.to}T00:00:00Z`);
    for (const [key, date] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value[key])
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Invalid calendar date' });
    }
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > 366)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Choose a period of 1–367 days' });
  });
export type AmbulatoryCommissionQueryInput = z.infer<typeof ambulatoryCommissionQuerySchema>;

/** Referral directions a doctor can earn a share on; EXO is a marked subset of ultrasound. */
export const AMBULATORY_SHARE_GROUPS = ['LAB', 'UZI', 'EXO', 'THERAPY'] as const;
export type AmbulatoryShareGroup = (typeof AMBULATORY_SHARE_GROUPS)[number];
export type AmbulatorySharePercents = Record<AmbulatoryShareGroup, number>;

/** Clinic defaults when no per-doctor override exists: UZI and EXO earn nothing unless set. */
export const AMBULATORY_DEFAULT_PERCENTS: AmbulatorySharePercents = {
  LAB: AMBULATORY_DEFAULT_LAB_PERCENT,
  UZI: 0,
  EXO: 0,
  THERAPY: AMBULATORY_DEFAULT_THERAPY_PERCENT,
};

const percentSchema = z.coerce.number().min(0).max(100).multipleOf(0.01);

export const ambulatoryRatesSchema = z.object({
  defaults: z.object({
    LAB: percentSchema,
    UZI: percentSchema,
    EXO: percentSchema,
    THERAPY: percentSchema,
  }),
  /** null removes the override, so the doctor falls back to the default of that group. */
  doctors: z
    .array(
      z.object({
        doctorUserId: idSchema,
        percents: z.object({
          LAB: percentSchema.nullable(),
          UZI: percentSchema.nullable(),
          EXO: percentSchema.nullable(),
          THERAPY: percentSchema.nullable(),
        }),
      }),
    )
    .max(500),
  /** Ultrasound services counted as EXO; every other ultrasound service is UZI. */
  echoServiceIds: z.array(idSchema).max(1000),
});
export type AmbulatoryRatesInput = z.infer<typeof ambulatoryRatesSchema>;

/**
 * Ozon terapiya / Gidrokolonoterapiya catalogue rows that earn the THERAPY share
 * when ordered from an ambulatory card (same idea as lab / UZI referrals).
 */
export function isAmbulatoryTherapyService(service: {
  code?: string | null;
  name?: unknown;
}): boolean {
  const code = (service.code ?? '').toUpperCase();
  if (code === 'DIAG-04' || code === 'DIAG-05') return true;
  const hay = (
    typeof service.name === 'string' ? service.name : JSON.stringify(service.name ?? '')
  ).toLowerCase();
  return /ozon\s*terap|озонотерап|gidrokolon|гидроколонотерап|hydrocolon/.test(hay);
}

/** Money values are decimal strings with 2 places. */
export interface AmbulatoryCommissionAmounts {
  orders: number;
  /** Billed amount of the referred work, net of invoice discounts. */
  amount: string;
  paidAmount: string;
  commission: string;
  /** Share the doctor will earn once the outstanding bills are paid. */
  pendingCommission: string;
}

export interface AmbulatoryCommissionTotals extends AmbulatoryCommissionAmounts {
  patients: number;
  byGroup: Record<AmbulatoryShareGroup, AmbulatoryCommissionAmounts>;
}

export interface AmbulatoryCommissionDoctor extends AmbulatoryCommissionTotals {
  doctorUserId: string;
  doctorName: string;
  specialty: string | null;
  /** Rates for new orders today (orders keep their own snapshot). */
  currentPercents: AmbulatorySharePercents;
}

export type AmbulatoryPaymentState = 'PAID' | 'PARTIAL' | 'UNPAID';

export interface AmbulatoryCommissionOrder {
  group: AmbulatoryShareGroup;
  orderId: string;
  orderNumber: string;
  createdAt: string;
  caseId: string;
  caseNumber: string;
  patient: { id: string; mrn: string; fullName: string };
  doctorUserId: string;
  doctorName: string;
  /** Test / examination names as stored: { uz, ru, en } or a plain string. */
  tests: Array<Record<string, string> | string>;
  invoiceNumber: string | null;
  amount: string;
  paidAmount: string;
  percent: number;
  commission: string;
  pendingCommission: string;
  paymentState: AmbulatoryPaymentState;
}

export interface AmbulatoryCommissionReport {
  from: string;
  to: string;
  doctorUserId: string | null;
  defaultPercents: AmbulatorySharePercents;
  totals: AmbulatoryCommissionTotals;
  doctors: AmbulatoryCommissionDoctor[];
  orders: AmbulatoryCommissionOrder[];
}

export interface AmbulatoryRateDoctor {
  doctorUserId: string;
  fullName: string;
  specialty: string | null;
  percents: Record<AmbulatoryShareGroup, number | null>;
}

export interface AmbulatoryUltrasoundService {
  id: string;
  code: string;
  name: Record<string, string> | string;
  category: string;
  isEcho: boolean;
}

export interface AmbulatoryRates {
  defaults: AmbulatorySharePercents;
  doctors: AmbulatoryRateDoctor[];
  ultrasoundServices: AmbulatoryUltrasoundService[];
}
