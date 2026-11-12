import { Prisma } from '@prisma/client';
import type { AmbulatoryCase } from '@prisma/client';
import { AMBULATORY_DEFAULT_LAB_PERCENT } from '@avishifo/shared';
import type { TenantTransactionClient } from '../../core/prisma/tenant-extension';

/** Clinic.settings key holding the default lab share percent. */
export const AMBULATORY_PERCENT_SETTING = 'ambulatoryLabPercent';

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

/** Doctor's override, else the clinic default, else 25%. */
export async function ambulatoryLabPercent(
  tx: TenantTransactionClient,
  clinicId: string,
  doctorUserId: string,
): Promise<number> {
  const override = await tx.ambulatoryCommissionRate.findFirst({
    where: { doctorUserId },
    select: { percent: true },
  });
  if (override) return override.percent.toNumber();
  const clinic = await tx.clinic.findUnique({ where: { id: clinicId }, select: { settings: true } });
  const value = ((clinic?.settings ?? {}) as Record<string, unknown>)[AMBULATORY_PERCENT_SETTING];
  return typeof value === 'number' && value >= 0 && value <= 100
    ? value
    : AMBULATORY_DEFAULT_LAB_PERCENT;
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
  const percent = await ambulatoryLabPercent(tx, clinicId, card.doctorUserId);
  await tx.labOrder.update({
    where: { id: orderId },
    data: {
      ambulatoryCaseId: card.id,
      ambulatoryCommissionPercent: new Prisma.Decimal(percent),
      referringDoctorUserId: card.doctorUserId,
      referringDoctorName: card.doctorName,
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
  if (card)
    await tx.clinicalOrder.update({ where: { id: orderId }, data: { ambulatoryCaseId: card.id } });
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
