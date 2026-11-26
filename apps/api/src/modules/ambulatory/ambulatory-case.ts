import { Prisma } from '@prisma/client';
import type { AmbulatoryCase } from '@prisma/client';
import {
  AMBULATORY_DEFAULT_PERCENTS,
  AMBULATORY_SHARE_GROUPS,
  type AmbulatorySharePercents,
  type AmbulatoryShareGroup,
} from '@avishifo/shared';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';

/** Clinic.settings keys holding the default share percent of each group. */
export const AMBULATORY_PERCENT_SETTINGS: Record<AmbulatoryShareGroup, string> = {
  LAB: 'ambulatoryLabPercent',
  UZI: 'ambulatoryUziPercent',
  EXO: 'ambulatoryEchoPercent',
  THERAPY: 'ambulatoryTherapyPercent',
};

type PercentReader = Pick<TenantTransactionClient, 'ambulatoryCommissionRate' | 'clinic'>;

function validPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function defaultPercentsFrom(settings: unknown): AmbulatorySharePercents {
  const values = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const result = { ...AMBULATORY_DEFAULT_PERCENTS };
  for (const group of AMBULATORY_SHARE_GROUPS) {
    const value = values[AMBULATORY_PERCENT_SETTINGS[group]];
    if (validPercent(value)) result[group] = value;
  }
  return result;
}

export function overridePercents(
  rate: {
    percent: Prisma.Decimal | null;
    uziPercent: Prisma.Decimal | null;
    echoPercent: Prisma.Decimal | null;
    therapyPercent?: Prisma.Decimal | null;
  } | null,
): Record<AmbulatoryShareGroup, number | null> {
  return {
    LAB: rate?.percent?.toNumber() ?? null,
    UZI: rate?.uziPercent?.toNumber() ?? null,
    EXO: rate?.echoPercent?.toNumber() ?? null,
    THERAPY: rate?.therapyPercent?.toNumber() ?? null,
  };
}

/** Doctor's override per group, else the clinic default of that group. */
export async function ambulatoryPercents(
  db: PercentReader,
  clinicId: string,
  doctorUserId: string,
): Promise<AmbulatorySharePercents> {
  const [rate, clinic] = await Promise.all([
    db.ambulatoryCommissionRate.findFirst({
      where: { doctorUserId },
      select: { percent: true, uziPercent: true, echoPercent: true, therapyPercent: true },
    }),
    db.clinic.findUnique({ where: { id: clinicId }, select: { settings: true } }),
  ]);
  const defaults = defaultPercentsFrom(clinic?.settings);
  const overrides = overridePercents(rate);
  return {
    LAB: overrides.LAB ?? defaults.LAB,
    UZI: overrides.UZI ?? defaults.UZI,
    EXO: overrides.EXO ?? defaults.EXO,
    THERAPY: overrides.THERAPY ?? defaults.THERAPY,
  };
}

/** "AK-2026-0001", sequential per clinic per year. */
export async function nextAmbulatoryNumber(
  tx: TenantTransactionClient,
  clinicId: string,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clinicId + ':ambulatory-number'}, 0))`;
  const prefix = `AK-${new Date().getFullYear()}-`;
  const last = await tx.ambulatoryCase.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function hasActiveStay(
  tx: TenantTransactionClient,
  patientId: string,
  branchId: string,
): Promise<boolean> {
  const stay = await tx.admission.findFirst({
    where: { patientId, branchId, status: 'ACTIVE' },
    select: { id: true },
  });
  return Boolean(stay);
}

/**
 * The patient's OPEN card with this doctor, opened when missing.
 * Locks the patient row so concurrent referrals land on one card.
 */
export async function ensureOpenAmbulatoryCase(
  tx: TenantTransactionClient,
  input: {
    clinicId: string;
    branchId: string;
    patientId: string;
    doctorUserId: string;
    doctorName: string;
    userId: string | null;
  },
): Promise<{ card: AmbulatoryCase; created: boolean }> {
  await tx.$queryRaw`SELECT "id" FROM "Patient" WHERE "id" = ${input.patientId} AND "clinicId" = ${input.clinicId} FOR UPDATE`;
  const existing = await tx.ambulatoryCase.findFirst({
    where: {
      patientId: input.patientId,
      branchId: input.branchId,
      doctorUserId: input.doctorUserId,
      status: 'OPEN',
    },
  });
  if (existing) return { card: existing, created: false };
  const card = await tx.ambulatoryCase.create({
    data: {
      clinicId: input.clinicId,
      branchId: input.branchId,
      patientId: input.patientId,
      number: await nextAmbulatoryNumber(tx, input.clinicId),
      doctorUserId: input.doctorUserId,
      doctorName: input.doctorName,
      openedAt: new Date(),
      openedById: input.userId,
    },
  });
  return { card, created: true };
}

/**
 * Card of an outpatient doctor visit: the card its consultation order sits on,
 * else the doctor's open card (opened when missing). Inpatient and UZI visits
 * have no card — their work is billed to the stay / belongs to the referrer.
 */
export async function ambulatoryCaseForVisit(
  tx: TenantTransactionClient,
  clinicId: string,
  visitId: string,
  userId: string | null,
): Promise<AmbulatoryCase | null> {
  const visit = await tx.visit.findFirst({
    where: { id: visitId },
    select: {
      id: true,
      kind: true,
      patientId: true,
      branchId: true,
      doctorUserId: true,
      clinicalOrder: { select: { id: true, kind: true, ambulatoryCaseId: true } },
    },
  });
  if (!visit || visit.kind !== 'CONSULTATION') return null;
  if (await hasActiveStay(tx, visit.patientId, visit.branchId)) return null;
  if (visit.clinicalOrder?.ambulatoryCaseId)
    return tx.ambulatoryCase.findFirst({ where: { id: visit.clinicalOrder.ambulatoryCaseId } });
  const doctor = await tx.user.findFirst({
    where: { id: visit.doctorUserId, clinicId, role: 'DOCTOR', deletedAt: null },
    select: { id: true, fullName: true },
  });
  if (!doctor) return null;
  const { card } = await ensureOpenAmbulatoryCase(tx, {
    clinicId,
    branchId: visit.branchId,
    patientId: visit.patientId,
    doctorUserId: doctor.id,
    doctorName: doctor.fullName,
    userId,
  });
  if (visit.clinicalOrder && visit.clinicalOrder.kind === 'CONSULTATION')
    await tx.clinicalOrder.update({
      where: { id: visit.clinicalOrder.id },
      data: { ambulatoryCaseId: card.id },
    });
  return card;
}

/** Puts a cashier-billed lab order on a card with the card doctor's share snapshot. */
export async function linkLabOrderToCase(
  tx: TenantTransactionClient,
  clinicId: string,
  orderId: string,
  card: Pick<AmbulatoryCase, 'id' | 'doctorUserId' | 'doctorName'>,
): Promise<void> {
  const percents = await ambulatoryPercents(tx, clinicId, card.doctorUserId);
  await tx.labOrder.update({
    where: { id: orderId },
    data: {
      ambulatoryCaseId: card.id,
      ambulatoryCommissionPercent: new Prisma.Decimal(percents.LAB),
      referringDoctorUserId: card.doctorUserId,
      referringDoctorName: card.doctorName,
    },
  });
}

/** Puts a UZI order on a card with the card doctor's UZI and EXO share snapshot. */
export async function linkUziOrderToCase(
  tx: TenantTransactionClient,
  clinicId: string,
  orderId: string,
  card: Pick<AmbulatoryCase, 'id' | 'doctorUserId'>,
): Promise<void> {
  const percents = await ambulatoryPercents(tx, clinicId, card.doctorUserId);
  await tx.clinicalOrder.update({
    where: { id: orderId },
    data: {
      ambulatoryCaseId: card.id,
      ambulatoryUziPercent: new Prisma.Decimal(percents.UZI),
      ambulatoryEchoPercent: new Prisma.Decimal(percents.EXO),
    },
  });
}

/**
 * Lab order created against a doctor visit → that visit's card. No-op for
 * inpatient work (no cashier invoice), orders already on a card, or visits without one.
 */
export async function attachLabOrderToVisitCase(
  tx: TenantTransactionClient,
  clinicId: string,
  orderId: string,
  userId: string | null,
): Promise<void> {
  const order = await tx.labOrder.findFirst({
    where: { id: orderId },
    select: { visitId: true, invoiceId: true, ambulatoryCaseId: true },
  });
  if (!order?.visitId || !order.invoiceId || order.ambulatoryCaseId) return;
  const card = await ambulatoryCaseForVisit(tx, clinicId, order.visitId, userId);
  if (card) await linkLabOrderToCase(tx, clinicId, orderId, card);
}

/** UZI ordered from a doctor visit → that visit's card. */
export async function attachClinicalOrderToVisitCase(
  tx: TenantTransactionClient,
  clinicId: string,
  orderId: string,
  visitId: string,
  userId: string | null,
): Promise<void> {
  const card = await ambulatoryCaseForVisit(tx, clinicId, visitId, userId);
  if (card) await linkUziOrderToCase(tx, clinicId, orderId, card);
}

/**
 * The card doctor's visit currently in progress for this card, if any —
 * orders sent from the card are mirrored onto it as visit referrals.
 */
export async function openVisitForCase(
  tx: TenantTransactionClient,
  card: Pick<AmbulatoryCase, 'id' | 'doctorUserId'>,
): Promise<string | null> {
  const order = await tx.clinicalOrder.findFirst({
    where: {
      ambulatoryCaseId: card.id,
      kind: 'CONSULTATION',
      doctorUserId: card.doctorUserId,
      visit: { status: 'IN_PROGRESS' },
    },
    orderBy: { createdAt: 'desc' },
    select: { visitId: true },
  });
  return order?.visitId ?? null;
}
