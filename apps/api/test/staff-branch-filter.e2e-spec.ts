import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { API, createApp, createTestClinic, login, type LoginResult, type TestClinic } from './setup';

/**
 * No explicit branch assignment means the staff member works in EVERY branch
 * (the /auth/me rule) — so a branch filter must keep branchless staff visible
 * instead of hiding them from every branch at once.
 */
describe('staff branch filter (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  let otherBranchId: string;

  const auth = (u: LoginResult): Record<string, string> => ({
    Authorization: `Bearer ${u.accessToken}`,
  });

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'brfilter');
    owner = await login(app, clinic.owner.email);

    const branch = await request(app.getHttpServer())
      .post(`${API}/branches`)
      .set(auth(owner))
      .send({ name: `Ikkinchi filial ${clinic.tag}`, address: 'Toshkent' })
      .expect(201);
    otherBranchId = branch.body.data.id as string;

    // A doctor with NO branch assignment at all…
    await request(app.getHttpServer())
      .post(`${API}/users`)
      .set(auth(owner))
      .send({
        fullName: `Filialsiz Shifokor ${clinic.tag}`,
        password: 'E2ePass123!',
        role: 'DOCTOR',
        branchIds: [],
      })
      .expect(201);
    // …and one pinned to the OTHER branch only.
    await request(app.getHttpServer())
      .post(`${API}/users`)
      .set(auth(owner))
      .send({
        fullName: `Ikkinchi-filial Shifokor ${clinic.tag}`,
        password: 'E2ePass123!',
        role: 'DOCTOR',
        branchIds: [otherBranchId],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('keeps branchless staff visible under any branch filter', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/staff`)
      .query({ branchId: clinic.branchId, limit: 100 })
      .set(auth(owner))
      .expect(200);
    const names = (res.body.data as Array<{ fullName: string }>).map((s) => s.fullName);
    expect(names).toContain(`Filialsiz Shifokor ${clinic.tag}`);
    // The explicitly-elsewhere doctor must NOT leak into this branch.
    expect(names).not.toContain(`Ikkinchi-filial Shifokor ${clinic.tag}`);
    // Explicit members of the filtered branch still appear.
    const doctor = await prisma.user.findUnique({ where: { id: clinic.doctor.id } });
    expect(names).toContain(doctor?.fullName);
  });

  it('applies the same rule to the settings users list', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/users`)
      .query({ branchId: otherBranchId, limit: 100 })
      .set(auth(owner))
      .expect(200);
    const names = (res.body.data as Array<{ fullName: string }>).map((u) => u.fullName);
    expect(names).toContain(`Filialsiz Shifokor ${clinic.tag}`);
    expect(names).toContain(`Ikkinchi-filial Shifokor ${clinic.tag}`);
  });
});
