import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { AppConfigService } from '../src/core/config/app-config.service';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { TelegramPatientAccessService } from '../src/modules/notifications/telegram-patient-access.service';
import { patientDocumentVisibility } from '../src/modules/patients/patient-document-access';

// Deliberately independent of the Nest e2e harness: no bot, worker, Redis,
// notification channel, migration or seed is initialized. DATABASE_URL must
// explicitly point at this existing isolated database before Prisma is created.
function isolatedDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('An isolated DATABASE_URL is required');
  const url = new URL(value);
  if (
    url.pathname !== '/avishifo_finance_migration' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('Telegram integration tests require local avishifo_finance_migration');
  return url.toString();
}

const prisma = new PrismaClient({ datasourceUrl: isolatedDatabaseUrl() });
const clinicIds: string[] = [];
const fixturePhones: string[] = [];
const fixtureChats: number[] = [];

async function uniquePhone(): Promise<string> {
  for (;;) {
    const phone = `+99877${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    if (fixturePhones.includes(phone)) continue;
    const [accounts, patients] = await Promise.all([
      prisma.portalAccount.count({ where: { phone } }),
      prisma.patient.count({ where: { phone } }),
    ]);
    if (accounts || patients) continue;
    fixturePhones.push(phone);
    return phone;
  }
}

async function uniqueChat(): Promise<number> {
  for (;;) {
    const chat = randomInt(1_000_000_000_000, 9_000_000_000_000);
    if (fixtureChats.includes(chat)) continue;
    const [accounts, links] = await Promise.all([
      prisma.portalAccount.count({ where: { telegramChatId: String(chat) } }),
      prisma.telegramLink.count({ where: { chatId: String(chat) } }),
    ]);
    if (accounts || links) continue;
    fixtureChats.push(chat);
    return chat;
  }
}

async function createClinic() {
  const id = randomUUID();
  clinicIds.push(id);
  return prisma.clinic.create({
    data: { id, name: `E2E Telegram patient ${id}`, status: 'ACTIVE' },
  });
}

async function createPatient(clinicId: string, phone: string) {
  return prisma.patient.create({
    data: {
      clinicId,
      phone,
      mrn: `TEST-${randomUUID()}`,
      firstName: 'Synthetic',
      lastName: 'Telegram test',
      fullName: 'Synthetic Telegram test',
      tags: [],
    },
  });
}

async function fixture(withPatient = true) {
  const clinic = await createClinic();
  const phone = await uniquePhone();
  const chat = await uniqueChat();
  const patient = withPatient ? await createPatient(clinic.id, phone) : null;
  const service = new TelegramPatientAccessService(
    { unscoped: prisma } as PrismaService,
    { env: { SINGLE_CLINIC_MODE: true, TELEGRAM_CLINIC_ID: clinic.id } } as AppConfigService,
  );
  return { clinic, phone, chat, patient, service };
}

async function document(clinicId: string, patientId: string, title: string, labOrderId?: string) {
  return prisma.patientDocument.create({
    data: {
      clinicId,
      patientId,
      title,
      fileKey: `test-only/${randomUUID()}`,
      fileName: 'synthetic.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 0,
      ...(labOrderId ? { labOrderId } : {}),
    },
  });
}

describe('Telegram verified patient access with real Prisma (isolated fixtures only)', () => {
  beforeAll(() => prisma.$connect());

  afterAll(async () => {
    try {
      // Delete only this run's UUID-scoped fixture rows; never reset the schema,
      // delete another test's clinic or operate on a production database.
      await prisma.$transaction(async (tx) => {
        const where = { clinicId: { in: clinicIds } };
        await tx.telegramLink.deleteMany({ where });
        await tx.labResult.deleteMany({ where });
        await tx.labOrderItem.deleteMany({ where });
        await tx.patientDocument.deleteMany({ where });
        await tx.labOrder.deleteMany({ where });
        await tx.labTest.deleteMany({ where });
        await tx.patient.deleteMany({ where });
        await tx.branch.deleteMany({ where });
        await tx.clinic.deleteMany({ where: { id: { in: clinicIds } } });
        await tx.portalAccount.deleteMany({ where: { phone: { in: fixturePhones } } });
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('links the own contact and scopes ready documents to that patient and configured clinic', async () => {
    const f = await fixture();
    const otherClinic = await createClinic();
    const otherPatient = await createPatient(otherClinic.id, f.phone);
    const unrelatedPatient = await createPatient(f.clinic.id, await uniquePhone());
    const ownedFile = await document(f.clinic.id, f.patient!.id, 'Owned general file');
    await document(otherClinic.id, otherPatient.id, 'Other clinic file');
    await document(f.clinic.id, unrelatedPatient.id, 'Other patient file');
    const branch = await prisma.branch.create({
      data: { clinicId: f.clinic.id, name: 'Synthetic branch' },
    });
    const labTest = await prisma.labTest.create({
      data: { clinicId: f.clinic.id, code: 'TG-E2E', name: { uz: 'Synthetic result' } },
    });
    const approvedOrder = await prisma.labOrder.create({
      data: {
        clinicId: f.clinic.id,
        branchId: branch.id,
        patientId: f.patient!.id,
        orderNumber: 'TG-APPROVED',
        status: 'APPROVED',
      },
    });
    const draftOrder = await prisma.labOrder.create({
      data: {
        clinicId: f.clinic.id,
        branchId: branch.id,
        patientId: f.patient!.id,
        orderNumber: 'TG-DRAFT',
        status: 'ORDERED',
      },
    });
    const approvedFile = await document(
      f.clinic.id,
      f.patient!.id,
      'Approved lab file',
      approvedOrder.id,
    );
    await document(f.clinic.id, f.patient!.id, 'Draft lab file', draftOrder.id);
    await prisma.labOrderItem.create({
      data: {
        clinicId: f.clinic.id,
        orderId: approvedOrder.id,
        labTestId: labTest.id,
        result: {
          create: {
            clinicId: f.clinic.id,
            approvedAt: new Date(),
            approvedById: randomUUID(),
            reportDocumentId: approvedFile.id,
          },
        },
      },
    });

    const linked = await f.service.linkContact(f.chat, f.phone.slice(1), 'synthetic_patient');
    expect(linked.status).toBe('LINKED');
    expect(linked.patients.map((p) => p.id)).toEqual([f.patient!.id]);
    expect((await f.service.resolve(f.chat)).patients.map((p) => p.id)).toEqual([f.patient!.id]);
    const patientIds = await f.service.patientIds(f.chat);
    const visible = await prisma.patientDocument.findMany({
      where: patientDocumentVisibility(patientIds),
      select: { id: true },
    });
    expect(visible.map((d) => d.id).sort()).toEqual([ownedFile.id, approvedFile.id].sort());
    const readyLabs = await prisma.labOrder.findMany({
      where: { patientId: { in: patientIds }, status: { in: ['APPROVED', 'DELIVERED'] } },
    });
    expect(readyLabs.map((o) => o.id)).toEqual([approvedOrder.id]);
    expect(await f.service.recipientFor(otherPatient.id, otherClinic.id)).toBeNull();
  });

  it('blocks a duplicate primary phone and removes previously active routing until corrected', async () => {
    const f = await fixture();
    await f.service.linkContact(f.chat, f.phone, null);
    const duplicate = await createPatient(f.clinic.id, f.phone);
    expect(await f.service.resolve(f.chat)).toEqual({ status: 'AMBIGUOUS', patients: [] });
    expect(await f.service.recipientFor(f.patient!.id, f.clinic.id)).toBeNull();
    expect(
      await prisma.telegramLink.count({ where: { clinicId: f.clinic.id, isActive: true } }),
    ).toBe(0);
    await prisma.patient.delete({ where: { id: duplicate.id } });
    expect(await f.service.patientIds(f.chat)).toEqual([f.patient!.id]);
  });

  it('finds a later registration using the saved verified contact', async () => {
    const f = await fixture(false);
    expect(await f.service.linkContact(f.chat, f.phone, null)).toEqual({
      status: 'NOT_FOUND',
      patients: [],
    });
    const patient = await createPatient(f.clinic.id, f.phone);
    expect(await f.service.patientIds(f.chat)).toEqual([patient.id]);
    expect(await f.service.recipientFor(patient.id, f.clinic.id)).toBe(String(f.chat));
  });

  it.each([false, true])(
    'keeps exactly one owner after concurrent same-phone binding (existing account: %s)',
    async (existing) => {
      const f = await fixture();
      const secondChat = await uniqueChat();
      if (existing) await f.service.linkContact(f.chat, f.phone, null);
      const results = await Promise.all([
        f.service.linkContact(f.chat, f.phone, 'first_patient'),
        f.service.linkContact(secondChat, f.phone, 'second_patient'),
      ]);
      expect(results.every((result) => result.status === 'LINKED')).toBe(true);
      const account = await prisma.portalAccount.findUniqueOrThrow({ where: { phone: f.phone } });
      expect([String(f.chat), String(secondChat)]).toContain(account.telegramChatId);
      const winner = Number(account.telegramChatId);
      const loser = winner === f.chat ? secondChat : f.chat;
      expect(await f.service.patientIds(winner)).toEqual([f.patient!.id]);
      expect(await f.service.resolve(loser)).toEqual({ status: 'UNLINKED', patients: [] });
      const active = await prisma.telegramLink.findMany({
        where: { clinicId: f.clinic.id, isActive: true },
      });
      expect(active.map((link) => link.chatId)).toEqual([String(winner)]);
      expect(await f.service.recipientFor(f.patient!.id, f.clinic.id)).toBe(String(winner));
    },
  );

  it('revokes access after a phone change and deletion, and unlinks without deleting the medical card', async () => {
    const f = await fixture();
    await f.service.linkContact(f.chat, f.phone, null);
    await prisma.patient.update({
      where: { id: f.patient!.id },
      data: { phone: await uniquePhone() },
    });
    expect(await f.service.resolve(f.chat)).toEqual({ status: 'NOT_FOUND', patients: [] });
    expect(await f.service.recipientFor(f.patient!.id, f.clinic.id)).toBeNull();
    await prisma.patient.update({ where: { id: f.patient!.id }, data: { phone: f.phone } });
    expect(await f.service.patientIds(f.chat)).toEqual([f.patient!.id]);
    await prisma.patient.update({ where: { id: f.patient!.id }, data: { deletedAt: new Date() } });
    expect(await f.service.resolve(f.chat)).toEqual({ status: 'NOT_FOUND', patients: [] });
    await prisma.patient.update({ where: { id: f.patient!.id }, data: { deletedAt: null } });
    expect(await f.service.patientIds(f.chat)).toEqual([f.patient!.id]);
    await f.service.unlink(f.chat);
    expect(await f.service.resolve(f.chat)).toEqual({ status: 'UNLINKED', patients: [] });
    expect(await f.service.recipientFor(f.patient!.id, f.clinic.id)).toBeNull();
    expect(await prisma.patient.count({ where: { id: f.patient!.id } })).toBe(1);
    expect(
      await prisma.telegramLink.count({ where: { clinicId: f.clinic.id, isActive: true } }),
    ).toBe(0);
  });
});
