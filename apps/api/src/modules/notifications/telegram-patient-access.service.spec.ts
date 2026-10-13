import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { AppConfigService } from '../../core/config/app-config.service';
import { TelegramPatientAccessService } from './telegram-patient-access.service';

const phone = '+998901234567';
const otherPhone = '+998907654321';
const now = new Date('2026-10-13T00:00:00Z');
interface Account {
  phone: string;
  phoneVerifiedAt: Date | null;
  telegramChatId: string | null;
  telegramUsername?: string | null;
  telegramLinkedAt?: Date | null;
}
interface Patient {
  id: string;
  clinicId: string;
  mrn: string;
  fullName: string;
  phone: string | null;
  dob: Date | null;
  deletedAt: Date | null;
  phoneAlt?: string;
}
interface Link {
  clinicId: string;
  patientId: string;
  chatId: string;
  phone: string;
  isActive: boolean;
}
interface State {
  accounts: Account[];
  patients: Patient[];
  links: Link[];
  clinics: { id: string; status: string }[];
}
function patient(
  id = 'patient-a',
  clinicId = 'clinic-a',
  primaryPhone: string | null = phone,
): Patient {
  return {
    id,
    clinicId,
    mrn: 'P-1',
    fullName: 'Test patient',
    phone: primaryPhone,
    dob: null,
    deletedAt: null,
  };
}

// Stateful transactional fake: tests exercise ownership transitions and rollback,
// not just individual Prisma query shapes. All delivery and database I/O is local.
function harness(singleClinic = true, configuredClinic?: string) {
  const state: State = {
    accounts: [{ phone, phoneVerifiedAt: now, telegramChatId: '1234' }],
    patients: [patient()],
    links: [
      { clinicId: 'clinic-a', patientId: 'patient-a', phone, chatId: '1234', isActive: true },
    ],
    clinics: [{ id: 'clinic-a', status: 'ACTIVE' }],
  };
  const accountFind = vi.fn(
    async ({ where }: { where: { phone?: string; telegramChatId?: string } }) =>
      state.accounts.find((a) =>
        where.phone !== undefined
          ? a.phone === where.phone
          : a.telegramChatId === where.telegramChatId,
      ) ?? null,
  );
  const accountUpdate = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { telegramChatId: string; phone?: { not: string } };
      data: Partial<Account>;
    }) => {
      const rows = state.accounts.filter(
        (a) =>
          a.telegramChatId === where.telegramChatId &&
          (!where.phone || a.phone !== where.phone.not),
      );
      rows.forEach((a) => Object.assign(a, data));
      return { count: rows.length };
    },
  );
  const accountUpsert = vi.fn(
    async ({
      where,
      update,
      create,
    }: {
      where: { phone: string };
      update: Partial<Account>;
      create: Account;
    }) => {
      const row = state.accounts.find((a) => a.phone === where.phone);
      if (row) Object.assign(row, update);
      else state.accounts.push({ ...create });
      return row ?? create;
    },
  );
  type LinkWhere = { OR?: LinkWhere[]; chatId?: string; phone?: string };
  function matchesLink(link: Link, where: LinkWhere): boolean {
    return (
      (!where.OR || where.OR.some((child) => matchesLink(link, child))) &&
      (where.chatId === undefined || link.chatId === where.chatId) &&
      (where.phone === undefined || link.phone === where.phone)
    );
  }
  const linkUpdate = vi.fn(async ({ where, data }: { where: LinkWhere; data: Partial<Link> }) => {
    const rows = state.links.filter((l) => matchesLink(l, where));
    rows.forEach((l) => Object.assign(l, data));
    return { count: rows.length };
  });
  const linkUpsert = vi.fn(
    async ({
      where,
      update,
      create,
    }: {
      where: { clinicId_chatId: { clinicId: string; chatId: string } };
      update: Partial<Link>;
      create: Link;
    }) => {
      const key = where.clinicId_chatId;
      const row = state.links.find((l) => l.clinicId === key.clinicId && l.chatId === key.chatId);
      if (row) Object.assign(row, update);
      else state.links.push({ ...create });
      return row ?? create;
    },
  );
  type PatientWhere = {
    id?: string;
    clinicId?: string | { in: string[] };
    phone?: string;
    deletedAt?: null;
  };
  function matchesPatient(p: Patient, where: PatientWhere): boolean {
    return (
      (where.id === undefined || p.id === where.id) &&
      (where.clinicId === undefined ||
        (typeof where.clinicId === 'string'
          ? p.clinicId === where.clinicId
          : where.clinicId.in.includes(p.clinicId))) &&
      (where.phone === undefined || p.phone === where.phone) &&
      (where.deletedAt === undefined || p.deletedAt === null)
    );
  }
  const tx = {
    portalAccount: { findUnique: accountFind, updateMany: accountUpdate, upsert: accountUpsert },
    telegramLink: { updateMany: linkUpdate, upsert: linkUpsert },
    clinic: {
      findMany: vi.fn(
        async ({ where, take }: { where: { id?: string; status: string }; take?: number }) =>
          state.clinics
            .filter((c) => c.status === where.status && (!where.id || c.id === where.id))
            .slice(0, take),
      ),
    },
    patient: {
      findMany: vi.fn(async ({ where }: { where: PatientWhere }) =>
        state.patients.filter((p) => matchesPatient(p, where)),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: PatientWhere }) =>
          state.patients.find((p) => matchesPatient(p, where)) ?? null,
      ),
    },
  };
  const transaction = vi.fn(async (work: (db: typeof tx) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try {
      return await work(tx);
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  });
  const prisma = { unscoped: { $transaction: transaction } } as unknown as PrismaService;
  const config = {
    env: { SINGLE_CLINIC_MODE: singleClinic, TELEGRAM_CLINIC_ID: configuredClinic },
  } as AppConfigService;
  return { service: new TelegramPatientAccessService(prisma, config), state, transaction, tx };
}

const noPatients = (status: string) => ({ status, patients: [] });

describe('Telegram patient ownership and contact linking', () => {
  it('rejects group, unsafe and invalid chat identifiers before querying', async () => {
    const { service, transaction } = harness();
    for (const chat of [-100123, 0, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(await service.resolve(chat)).toEqual(noPatients('UNLINKED'));
      expect(await service.linkContact(chat, phone, null)).toEqual(noPatients('UNLINKED'));
    }
    expect(await service.linkContact(1234, 'not a phone', null)).toEqual(noPatients('UNLINKED'));
    expect(transaction).not.toHaveBeenCalled();
  });

  it('revokes stale routing for a missing or unverified account', async () => {
    for (const accounts of [[], [{ phone, phoneVerifiedAt: null, telegramChatId: '1234' }]]) {
      const { service, state } = harness();
      state.accounts = accounts;
      expect(await service.resolve(1234)).toEqual(noPatients('UNLINKED'));
      expect(state.links.every((l) => !l.isActive)).toBe(true);
    }
  });

  it('normalizes an own contact and connects the matching registered patient', async () => {
    const { service, state } = harness();
    state.accounts = [];
    state.links = [];
    const result = await service.linkContact(1234, '998 90 123 45 67', 'patient_name');
    expect(result.status).toBe('LINKED');
    expect(result.patients.map((p) => p.id)).toEqual(['patient-a']);
    expect(state.accounts[0]).toMatchObject({
      phone,
      telegramChatId: '1234',
      telegramUsername: 'patient_name',
      phoneVerifiedAt: expect.any(Date),
    });
    expect(state.links).toEqual([
      { clinicId: 'clinic-a', patientId: 'patient-a', phone, chatId: '1234', isActive: true },
    ]);
  });

  it('connects a patient registered after the contact was shared, without re-sharing', async () => {
    const { service, state } = harness();
    state.patients = [];
    expect(await service.linkContact(1234, phone, null)).toEqual(noPatients('NOT_FOUND'));
    state.patients.push(patient());
    expect(await service.patientIds(1234)).toEqual(['patient-a']);
    expect(state.links.filter((l) => l.isActive).map((l) => l.patientId)).toEqual(['patient-a']);
  });

  it('blocks shared/duplicate phone cards without exposing names and restores after correction', async () => {
    const { service, state } = harness();
    state.patients.push(patient('patient-b'));
    expect(await service.resolve(1234)).toEqual(noPatients('AMBIGUOUS'));
    expect(await service.recipientFor('patient-a', 'clinic-a')).toBeNull();
    expect(state.links.every((l) => !l.isActive)).toBe(true);
    state.patients.pop();
    expect(await service.patientIds(1234)).toEqual(['patient-a']);
  });

  it('never uses an alternate phone as ownership proof', async () => {
    const { service, state } = harness();
    state.patients[0]!.phone = otherPhone;
    state.patients[0]!.phoneAlt = phone;
    expect(await service.resolve(1234)).toEqual(noPatients('NOT_FOUND'));
    expect(state.links[0]!.isActive).toBe(false);
  });

  it('revokes access when the primary phone changes or the card is deleted', async () => {
    for (const change of [
      (p: Patient) => {
        p.phone = otherPhone;
      },
      (p: Patient) => {
        p.deletedAt = now;
      },
    ]) {
      const { service, state } = harness();
      change(state.patients[0]!);
      expect(await service.patientIds(1234)).toEqual([]);
      expect(await service.recipientFor('patient-a', 'clinic-a')).toBeNull();
      expect(state.links[0]!.isActive).toBe(false);
    }
  });

  it('moves one phone to the new chat and revokes every route held by the previous chat', async () => {
    const { service, state } = harness();
    state.links.push({
      clinicId: 'legacy-clinic',
      patientId: 'legacy-patient',
      phone: otherPhone,
      chatId: '1234',
      isActive: true,
    });
    expect((await service.linkContact(5678, phone, null)).status).toBe('LINKED');
    expect(state.links.filter((l) => l.chatId === '1234').every((l) => !l.isActive)).toBe(true);
    expect(await service.patientIds(1234)).toEqual([]);
    expect(await service.recipientFor('patient-a', 'clinic-a')).toBe('5678');
  });

  it('moves one chat to a new phone and releases its previous account and patient', async () => {
    const { service, state } = harness();
    state.patients.push(patient('patient-b', 'clinic-a', otherPhone));
    expect((await service.linkContact(1234, otherPhone, null)).patients.map((p) => p.id)).toEqual([
      'patient-b',
    ]);
    expect(state.accounts.find((a) => a.phone === phone)!.telegramChatId).toBeNull();
    expect(await service.recipientFor('patient-a', 'clinic-a')).toBeNull();
    expect(await service.recipientFor('patient-b', 'clinic-a')).toBe('1234');
  });

  it('rolls back the entire contact change when routing cannot be saved', async () => {
    const { service, state, tx } = harness();
    const before = structuredClone(state);
    tx.telegramLink.upsert.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.linkContact(5678, phone, null)).rejects.toThrow('database failure');
    expect(state).toEqual(before);
  });

  it('unlinks atomically and does not let an old chat unlink the new owner', async () => {
    const { service, state } = harness();
    await service.linkContact(5678, phone, null);
    await service.unlink(1234);
    expect(await service.recipientFor('patient-a', 'clinic-a')).toBe('5678');
    await service.unlink(5678);
    expect(state.accounts[0]!.telegramChatId).toBeNull();
    expect(state.links.every((l) => !l.isActive)).toBe(true);
    expect(await service.patientIds(5678)).toEqual([]);
  });
});

describe('Telegram clinic scope and delivery recipient', () => {
  it('fails closed when the single clinic is missing or ambiguous', async () => {
    for (const clinics of [
      [],
      [
        { id: 'clinic-a', status: 'ACTIVE' },
        { id: 'clinic-b', status: 'ACTIVE' },
      ],
    ]) {
      const { service, state } = harness();
      state.clinics = clinics;
      expect(await service.resolve(1234)).toEqual(noPatients('UNAVAILABLE'));
      expect(state.links.every((l) => !l.isActive)).toBe(true);
    }
  });

  it('scopes to the configured active clinic and excludes other clinics and old routes', async () => {
    const { service, state } = harness(true, 'clinic-a');
    state.clinics.push({ id: 'clinic-b', status: 'ACTIVE' });
    state.patients.push(patient('patient-b', 'clinic-b'));
    state.links.push({
      clinicId: 'clinic-b',
      patientId: 'patient-b',
      phone,
      chatId: '1234',
      isActive: true,
    });
    expect(await service.patientIds(1234)).toEqual(['patient-a']);
    expect(await service.recipientFor('patient-b', 'clinic-b')).toBeNull();
    expect(state.links.find((l) => l.clinicId === 'clinic-b')!.isActive).toBe(false);
  });

  it('rejects missing or inactive configured clinics', async () => {
    for (const clinic of ['missing-clinic', 'clinic-a']) {
      const { service, state } = harness(true, clinic);
      state.clinics[0]!.status = 'SUSPENDED';
      expect(await service.resolve(1234)).toEqual(noPatients('UNAVAILABLE'));
    }
  });

  it('supports one card per active clinic in platform mode but blocks same-clinic ambiguity', async () => {
    const { service, state } = harness(false);
    state.clinics.push(
      { id: 'clinic-b', status: 'ACTIVE' },
      { id: 'clinic-c', status: 'SUSPENDED' },
    );
    state.patients.push(patient('patient-b', 'clinic-b'), patient('patient-c', 'clinic-c'));
    expect(await service.patientIds(1234)).toEqual(['patient-a', 'patient-b']);
    state.patients.push(patient('duplicate-b', 'clinic-b'));
    expect(await service.resolve(1234)).toEqual(noPatients('AMBIGUOUS'));
    expect(state.links.every((l) => !l.isActive)).toBe(true);
  });

  it('selects the current verified account instead of an outdated routing row', async () => {
    const { service, state } = harness();
    state.accounts[0]!.telegramChatId = '5678';
    expect(await service.recipientFor('patient-a', 'clinic-a')).toBe('5678');
    expect(state.links.find((l) => l.chatId === '1234')!.isActive).toBe(false);
    expect(await service.recipientFor('patient-a', 'foreign-clinic')).toBeNull();
    state.accounts[0]!.phoneVerifiedAt = null;
    expect(await service.recipientFor('patient-a', 'clinic-a')).toBeNull();
  });

  it('refuses invalid stored chat IDs and noncanonical/unverified phones', async () => {
    const { service, state } = harness();
    for (const chat of ['-123', '0', 'abc', '01234', String(Number.MAX_SAFE_INTEGER + 1)]) {
      state.accounts[0]!.telegramChatId = chat;
      expect(await service.recipientFor('patient-a', 'clinic-a')).toBeNull();
    }
    state.accounts[0]!.telegramChatId = '1234';
    state.accounts[0]!.phone = '901234567';
    expect(await service.resolve(1234)).toEqual(noPatients('UNLINKED'));
  });

  it('retries complete serializable decisions after conflicts and uniqueness races', async () => {
    for (const code of ['P2034', 'P2002']) {
      const { service, transaction } = harness();
      transaction.mockRejectedValueOnce({ code });
      expect(await service.patientIds(1234)).toEqual(['patient-a']);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    }
  });

  it('bounds transaction retries and propagates a persistent failure', async () => {
    const { service, transaction } = harness();
    transaction.mockRejectedValue({ code: 'P2034' });
    await expect(service.resolve(1234)).rejects.toEqual({ code: 'P2034' });
    expect(transaction).toHaveBeenCalledTimes(4);
  });
});
