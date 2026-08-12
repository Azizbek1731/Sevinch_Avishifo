import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AiToolRegistry } from '../src/modules/ai/ai-tools';
import { TenantContext } from '../src/core/prisma/tenant-context';
import {
  API,
  createApp,
  createTestClinic,
  login,
  type LoginResult,
  type TestClinic,
} from './setup';

/**
 * AviShifo AI — the tenancy and permission properties, exercised at the layer
 * that actually enforces them.
 *
 * These tests deliberately bypass Gemini. What matters is not what the model
 * says but what it is *able to reach*: the tool registry is the whole security
 * boundary, so it is driven directly, with arguments a jailbroken model would
 * emit if it could.
 */
describe('avishifo ai (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tools: AiToolRegistry;
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let ownerA: LoginResult;
  let receptionistA: LoginResult;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    tools = app.get(AiToolRegistry);
    clinicA = await createTestClinic(prisma, 'ai-a');
    clinicB = await createTestClinic(prisma, 'ai-b');
    ownerA = await login(app, clinicA.owner.email);
    receptionistA = await login(app, clinicA.receptionist.email);

    // One indebted patient in each clinic, so a leak would be unmistakable.
    for (const [c, name] of [
      [clinicA, 'AAA Qarzdor Bemor'],
      [clinicB, 'BBB Qarzdor Bemor'],
    ] as const) {
      await prisma.patient.create({
        data: {
          clinicId: c.clinicId,
          mrn: `AI-${c.tag.slice(0, 6)}`,
          firstName: name.split(' ')[0]!,
          lastName: 'Bemor',
          fullName: name,
          gender: 'MALE',
          balance: -250000,
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- tenancy

  it('no tool exposes a clinic parameter for a model to fill in', () => {
    // The property the whole design rests on: there is no argument the model
    // could emit that selects a tenant.
    const authUser = { ...ownerA.user, permissions: [] } as never;
    for (const tool of tools['all']() as Array<{ name: string; parameters: Record<string, unknown> }>) {
      const names = Object.keys(tool.parameters).map((k) => k.toLowerCase());
      expect(names.some((n) => n.includes('clinic') || n.includes('tenant'))).toBe(false);
    }
    void authUser;
  });

  it('returns only the caller own clinic rows, whatever the model asks for', async () => {
    const asA = await TenantContext.run({ clinicId: clinicA.clinicId }, () =>
      tools.execute('top_debtors', { limit: 50 }, ownerA.user as never),
    );
    expect(asA.ok).toBe(true);
    const rows = (asA as { ok: true; data: Array<{ fullName: string }> }).data;
    expect(rows.some((r) => r.fullName.startsWith('AAA'))).toBe(true);
    // Clinic B's debtor exists and has the larger name sort order, so its
    // absence here is the assertion that matters.
    expect(rows.some((r) => r.fullName.startsWith('BBB'))).toBe(false);
  });

  it('ignores a clinic id smuggled in as an extra argument', async () => {
    const result = await TenantContext.run({ clinicId: clinicA.clinicId }, () =>
      tools.execute(
        'top_debtors',
        // Exactly what a prompt-injected model would try.
        { limit: 50, clinicId: clinicB.clinicId, tenantId: clinicB.clinicId },
        ownerA.user as never,
      ),
    );
    expect(result.ok).toBe(true);
    const rows = (result as { ok: true; data: Array<{ fullName: string }> }).data;
    expect(rows.some((r) => r.fullName.startsWith('BBB'))).toBe(false);
  });

  it('refuses to run at all without a tenant context', async () => {
    await expect(
      tools.execute('count_patients', {}, ownerA.user as never),
    ).rejects.toThrow();
  });

  // ------------------------------------------------------------ permissions

  it('offers a receptionist fewer tools than an owner, and never payroll-grade ones', () => {
    const forOwner = tools.forUser(ownerA.user as never).map((t) => t.name);
    const forReception = tools.forUser(receptionistA.user as never).map((t) => t.name);

    expect(forOwner).toContain('revenue_report');
    expect(forOwner).toContain('doctor_performance');
    // The receptionist has neither reports.read nor staff.read.
    expect(forReception).not.toContain('revenue_report');
    expect(forReception).not.toContain('doctor_performance');
    expect(forReception.length).toBeLessThan(forOwner.length);
  });

  it('refuses a tool the caller was never offered, even when named directly', async () => {
    const result = await TenantContext.run({ clinicId: clinicA.clinicId }, () =>
      tools.execute('doctor_performance', { from: '2026-01-01', to: '2026-12-31' }, receptionistA.user as never),
    );
    expect(result).toEqual({ ok: false, error: 'unknown_or_not_permitted' });
  });

  it('reports an unknown tool the same way as a forbidden one', async () => {
    // A different answer here would tell a probing model which tools exist.
    const unknown = await TenantContext.run({ clinicId: clinicA.clinicId }, () =>
      tools.execute('drop_all_tables', {}, ownerA.user as never),
    );
    expect(unknown).toEqual({ ok: false, error: 'unknown_or_not_permitted' });
  });

  it('clamps a model-supplied row limit', async () => {
    const result = await TenantContext.run({ clinicId: clinicA.clinicId }, () =>
      tools.execute('top_debtors', { limit: 100000 }, ownerA.user as never),
    );
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: unknown[] }).data.length).toBeLessThanOrEqual(50);
  });

  // -------------------------------------------------------------- endpoint

  it('is disabled without an API key, and says so rather than half-working', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/ai/ask`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ question: 'Bu oy qancha tushum bo‘ldi?' });
    // No GEMINI_API_KEY in the test environment.
    expect(res.status).toBe(503);
  });

  it('refuses a caller without ai.use', async () => {
    await request(app.getHttpServer())
      .post(`${API}/ai/ask`)
      .set('Authorization', `Bearer ${receptionistA.accessToken}`)
      .send({ question: 'Bu oy qancha tushum bo‘ldi?' })
      .expect(403);
  });

  it('rejects an empty or oversized question before any model call', async () => {
    await request(app.getHttpServer())
      .post(`${API}/ai/ask`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ question: 'a' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`${API}/ai/ask`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ question: 'x'.repeat(1001) })
      .expect(400);
  });

  it('tells each caller only about the tools they may use', async () => {
    const owner = await request(app.getHttpServer())
      .get(`${API}/ai/capabilities`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(200);
    // Disabled without a key, so the list is empty — but the endpoint must not
    // leak the catalogue either way.
    expect(owner.body.data.enabled).toBe(false);
    expect(owner.body.data.tools).toEqual([]);
  });
});
