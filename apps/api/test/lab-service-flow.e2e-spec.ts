import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  API,
  createApp,
  createTestClinic,
  login,
  uniqueIp,
  type LoginResult,
  type TestClinic,
} from './setup';

/**
 * The lab-service pipeline, end to end: a service made from the standard
 * catalogue, sold at the desk, landing on the laboratory worklist by itself,
 * resulted, approved — and leaving the building as the same PDF through the
 * staff app and the patient portal.
 */
describe('lab service flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let owner: LoginResult;
  let labCategoryId: string;
  let patientId: string;
  let patientPhone: string;
  let branchId: string;
  let catalogServiceId: string;
  let manualServiceId: string;
  let orderId: string;
  let orderNumber: string;

  const auth = (u: LoginResult): Record<string, string> => ({
    Authorization: `Bearer ${u.accessToken}`,
  });

  /** Smallest valid PNG — the upload path verifies real magic bytes. */
  function tinyPng(): Buffer {
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crcTable: number[] = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
      let crc = 0xffffffff;
      for (const b of body) crc = (crcTable[(crc ^ b) & 0xff]! ^ (crc >>> 8)) >>> 0;
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
      return Buffer.concat([len, body, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolour
    const idat = deflateSync(Buffer.from([0, 255, 0, 0]));
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  /** Portal sessions are OTP-gated; mint one the way the record-access suite does. */
  async function portalLogin(phone: string): Promise<string> {
    await request(app.getHttpServer())
      .post(`${API}/portal/auth/request-otp`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone })
      .expect(200);
    const otp = await prisma.otpCode.findFirst({
      where: { phone, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp).not.toBeNull();
    const argon2 = await import('argon2');
    await prisma.otpCode.update({
      where: { id: otp!.id },
      data: { codeHash: await argon2.hash('123456', { type: argon2.argon2id }) },
    });
    const res = await request(app.getHttpServer())
      .post(`${API}/portal/auth/verify`)
      .set('X-Forwarded-For', uniqueIp())
      .send({ phone, code: '123456' })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, 'labsvc');
    owner = await login(app, clinic.owner.email);
    branchId = clinic.branchId;

    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set(auth(owner))
      .send({ name: 'Laboratoriya', kind: 'LAB' })
      .expect(201);
    labCategoryId = cat.body.data.id as string;

    patientPhone = `+9989${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
    const patient = await prisma.patient.create({
      data: {
        clinicId: clinic.clinicId,
        mrn: `LS-${randomUUID().slice(0, 6)}`,
        firstName: 'Tahlil',
        lastName: 'Bemor',
        fullName: 'Tahlil Bemor',
        gender: 'MALE',
        dob: new Date('1990-01-15'),
        phone: patientPhone,
      },
    });
    patientId = patient.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ------------------------------------------------------- service creation

  it('creates a service FROM the catalogue: test, analytes and intervals come along', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: labCategoryId,
        code: 'CBC',
        name: { uz: 'Umumiy qon tahlili' },
        durationMin: 15,
        vatIncluded: true,
        price: '50000.00',
        labCatalogCode: 'CBC',
      })
      .expect(201);
    catalogServiceId = res.body.data.id as string;

    const test = await prisma.labTest.findFirst({
      where: { serviceId: catalogServiceId },
      include: { parameters: true },
    });
    expect(test).not.toBeNull();
    expect(test!.catalogCode).toBe('CBC');
    // The whole panel, not a stub: CBC carries 13 analytes in the catalogue.
    expect(test!.parameters.length).toBeGreaterThanOrEqual(10);
    const hgb = test!.parameters.find((p) => p.code === 'HGB');
    expect(hgb).toBeDefined();
    expect(Array.isArray(hgb!.referenceRanges)).toBe(true);
    expect((hgb!.referenceRanges as unknown[]).length).toBeGreaterThan(5);
  });

  it('creates a hand-written LAB service: a bare test with one free-text answer', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: labCategoryId,
        code: `RAPID-${clinic.tag.slice(0, 6)}`,
        name: { uz: 'Ekspress-test' },
        durationMin: 10,
        vatIncluded: true,
        price: '40000.00',
      })
      .expect(201);
    manualServiceId = res.body.data.id as string;

    const test = await prisma.labTest.findFirst({
      where: { serviceId: manualServiceId },
      include: { parameters: true },
    });
    expect(test).not.toBeNull();
    expect(test!.catalogCode).toBeNull();
    expect(test!.parameters).toHaveLength(1);
    expect(test!.parameters[0]!.valueType).toBe('TEXT');
  });

  it('a service in a non-LAB category gets no lab test', async () => {
    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set(auth(owner))
      .send({ name: 'Konsultatsiya', kind: 'CONSULTATION' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: cat.body.data.id as string,
        code: `CONS-${clinic.tag.slice(0, 6)}`,
        name: { uz: 'Terapevt' },
        durationMin: 20,
        vatIncluded: true,
        price: '80000.00',
      })
      .expect(201);
    const test = await prisma.labTest.findFirst({
      where: { serviceId: res.body.data.id as string },
    });
    expect(test).toBeNull();
  });

  it('adopts an unclaimed imported test instead of dying on the code collision', async () => {
    // The clinic imported HBA1C from the lab page earlier — no service attached.
    await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(auth(owner))
      .send({ codes: ['HBA1C'], overwriteExisting: false })
      .expect(201);

    // Now a service is created under the SAME code, without labCatalogCode.
    // This used to 500: the unique violation aborted the transaction and the
    // adoption lookup died inside it.
    const res = await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: labCategoryId,
        code: 'HBA1C',
        name: { uz: 'Glikirlangan gemoglobin' },
        durationMin: 15,
        vatIncluded: true,
        price: '60000.00',
      })
      .expect(201);

    const test = await prisma.labTest.findFirst({
      where: { serviceId: res.body.data.id as string },
      include: { parameters: true },
    });
    // The imported test was adopted whole — catalogue analytes, not a bare stub.
    expect(test!.catalogCode).toBe('HBA1C');
    expect(test!.parameters[0]!.valueType).not.toBe(undefined);
  });

  it('refuses labCatalogCode outside a LAB category', async () => {
    const cat = await request(app.getHttpServer())
      .post(`${API}/service-categories`)
      .set(auth(owner))
      .send({ name: 'Boshqa', kind: 'OTHER' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/services`)
      .set(auth(owner))
      .send({
        categoryId: cat.body.data.id as string,
        code: 'WRONG-CAT',
        name: { uz: 'Xato' },
        durationMin: 15,
        vatIncluded: true,
        price: '10000.00',
        labCatalogCode: 'CBC',
      })
      .expect(400);
  });

  it('refuses an order for a branch outside the clinic', async () => {
    const foreign = await createTestClinic(prisma, 'labsvc-b');
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set(auth(owner))
      .send({
        patientId,
        branchId: foreign.branchId,
        settle: 'DEBT',
        lines: [{ serviceId: catalogServiceId, quantity: 1, unitPrice: '50000.00' }],
      })
      .expect(201);
    // The sale itself survives; the lab hook logs and yields no order rather
    // than stamping a foreign branch onto the worklist.
    expect(res.body.data.labOrder).toBeNull();
  });

  // ------------------------------------------------------------ the sale

  it('selling lab services creates ONE lab order and says so in the response', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set(auth(owner))
      .send({
        patientId,
        branchId,
        settle: 'DEBT',
        lines: [
          { serviceId: catalogServiceId, quantity: 1, unitPrice: '50000.00' },
          { serviceId: manualServiceId, quantity: 1, unitPrice: '40000.00' },
        ],
      })
      .expect(201);

    expect(res.body.data.labOrder).toBeTruthy();
    orderId = res.body.data.labOrder.id as string;
    orderNumber = res.body.data.labOrder.orderNumber as string;

    const order = await prisma.labOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    // Both lab services, one order — the patient gives blood once.
    expect(order!.items).toHaveLength(2);
    expect(order!.patientId).toBe(patientId);
  });

  it('a sale with no lab services creates no order', async () => {
    const cons = await prisma.service.findFirst({
      where: { clinicId: clinic.clinicId, code: { startsWith: 'CONS-' } },
    });
    const res = await request(app.getHttpServer())
      .post(`${API}/invoices/quick`)
      .set(auth(owner))
      .send({
        patientId,
        branchId,
        settle: 'DEBT',
        lines: [{ serviceId: cons!.id, quantity: 1, unitPrice: '80000.00' }],
      })
      .expect(201);
    expect(res.body.data.labOrder).toBeNull();
  });

  it('the patient card tab sees the order through ?patientId=', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-orders`)
      .set(auth(owner))
      .query({ patientId })
      .expect(200);
    const numbers = (res.body.data as Array<{ orderNumber: string }>).map((o) => o.orderNumber);
    expect(numbers).toContain(orderNumber);
  });

  // ---------------------------------------------------- results and files

  it('the technician enters results and attaches the analyser file', async () => {
    const detail = await request(app.getHttpServer())
      .get(`${API}/lab-orders/${orderId}`)
      .set(auth(owner))
      .expect(200);
    for (const item of detail.body.data.items as Array<{
      id: string;
      labTest: { parameters: Array<{ id: string; code: string | null }> };
    }>) {
      const param = item.labTest.parameters[0]!;
      await request(app.getHttpServer())
        .post(`${API}/lab-orders/items/${item.id}/results`)
        .set(auth(owner))
        .send({ values: [{ parameterId: param.id, value: param.code ? '130' : 'Manfiy' }] })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`${API}/lab-orders/${orderId}/attachments`)
      .set(auth(owner))
      .attach('file', tinyPng(), 'analyser.png')
      .field('title', 'Analizator varag‘i')
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`${API}/lab-orders/${orderId}`)
      .set(auth(owner))
      .expect(200);
    const attachments = after.body.data.attachments as Array<{ title: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.title).toBe('Analizator varag‘i');

    // The file is the patient's document too — visible in their folder.
    const doc = await prisma.patientDocument.findFirst({ where: { labOrderId: orderId } });
    expect(doc).not.toBeNull();
    expect(doc!.patientId).toBe(patientId);
    expect(doc!.category).toBe('ANALYSIS');
  });

  // -------------------------------------------------------------- the PDF

  it('the staff PDF endpoint returns a real PDF', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-orders/${orderId}/pdf`)
      .set(auth(owner))
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('the portal refuses the PDF before approval, serves it after, and never to a stranger', async () => {
    const ownToken = await portalLogin(patientPhone);
    // Not approved yet — a half-entered result is not a document.
    await request(app.getHttpServer())
      .get(`${API}/portal/me/lab-results/${orderId}/download`)
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`${API}/lab-orders/${orderId}/approve`)
      .set(auth(owner))
      .expect(201);

    const ok = await request(app.getHttpServer())
      .get(`${API}/portal/me/lab-results/${orderId}/download`)
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(200);
    expect(ok.headers['content-type']).toContain('application/pdf');

    // A different phone holds a perfectly valid token — and still gets nothing.
    const strangerPhone = `+9989${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
    const strangerToken = await portalLogin(strangerPhone);
    await request(app.getHttpServer())
      .get(`${API}/portal/me/lab-results/${orderId}/download`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(404);
  });
});
