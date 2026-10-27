import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  API,
  createApp,
  createTestClinic,
  login,
  uniquePhone,
  type LoginResult,
  type TestClinic,
} from './setup';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
);

describe('paid laboratory workflow and signed file results', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let reception: LoginResult;
  let cashier: LoginResult;
  let laboratory: LoginResult;
  let owner: LoginResult;
  let patientId: string;
  let orderId: string;
  let invoiceId: string;
  let structuredItemId: string;
  let fileItemId: string;
  let reportDocumentId: string;
  let testIds: string[];
  let serviceIds: string[];
  let parameterIds: string[];

  const get = (path: string, actor = laboratory) =>
    request(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const post = (path: string, actor = laboratory) =>
    request(app.getHttpServer())
      .post(`${API}${path}`)
      .set('Authorization', `Bearer ${actor.accessToken}`)
      .set('x-branch-id', clinic.branchId);
  const pay = (amount: string) =>
    post(`/invoices/${invoiceId}/payments`, cashier).send({
      amount,
      method: 'CASH',
      idempotencyKey: randomUUID(),
    });

  beforeAll(async () => {
    if (
      !/^\/(?:avishifo_finance_|.*(?:test|e2e))/.test(
        new URL(process.env.DATABASE_URL ?? '').pathname,
      )
    ) {
      throw new Error('Laboratory tests require an isolated finance/test database');
    }
    process.env.SINGLE_CLINIC_MODE = 'true';
    prisma = new PrismaClient();
    app = await createApp([]);
    clinic = await createTestClinic(prisma, `lab-workflow-${Date.now()}`);
    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: clinic.owner.id } });
    const labUser = await prisma.user.create({
      data: {
        clinicId: clinic.clinicId,
        role: 'LAB_TECH',
        fullName: 'Laboratory Test Operator',
        email: `lab-${clinic.tag}@e2e.avishifo.test`,
        phone: uniquePhone(),
        passwordHash: ownerRow.passwordHash,
        branches: { create: { clinicId: clinic.clinicId, branchId: clinic.branchId } },
      },
    });
    reception = await login(app, clinic.receptionist.email);
    cashier = await login(app, clinic.cashier.email);
    laboratory = await login(app, labUser.email!);
    owner = await login(app, clinic.owner.email);
    const patient = await post('/patients', reception).send({
      firstName: 'Laboratoriya',
      lastName: 'Sinov',
      phone: uniquePhone(),
    });
    expect(patient.status).toBe(201);
    patientId = patient.body.data.id as string;
    const category = await prisma.serviceCategory.create({
      data: { clinicId: clinic.clinicId, name: 'Lab test', kind: 'LAB' },
    });
    const tests = [];
    for (let index = 0; index < 2; index += 1) {
      const service = await prisma.service.create({
        data: {
          clinicId: clinic.clinicId,
          categoryId: category.id,
          code: `TEST-${index}`,
          name: { uz: `Laborator tekshiruv ${index}` },
          prices: {
            create: {
              clinicId: clinic.clinicId,
              price: index === 0 ? '100' : '200',
              effectiveFrom: new Date(Date.now() - 60_000),
            },
          },
        },
      });
      tests.push(
        await prisma.labTest.create({
          data: {
            clinicId: clinic.clinicId,
            code: `LAB-${index}`,
            name: { uz: `Test ${index}` },
            serviceId: service.id,
            parameters: {
              create: [0, 1].map((position) => ({
                clinicId: clinic.clinicId,
                name: `Parameter ${position}`,
                sortOrder: position,
                referenceRanges: [],
              })),
            },
          },
          include: { parameters: { orderBy: { sortOrder: 'asc' } } },
        }),
      );
    }
    testIds = tests.map((test) => test.id);
    serviceIds = tests.map((test) => test.serviceId!);
    parameterIds = tests[0]!.parameters.map((parameter) => parameter.id);
    expect(
      (
        await post('/shifts/open', cashier).send({
          openingCash: '0',
          openingCard: '0',
          openingClick: '0',
        })
      ).status,
    ).toBe(201);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('creates a bill with the order, hides unpaid work from the laboratory and denies reception clinical work', async () => {
    const created = await post('/lab-orders', reception).send({
      patientId,
      branchId: clinic.branchId,
      testIds,
    });
    expect(created.status).toBe(201);
    orderId = created.body.data.id as string;
    invoiceId = created.body.data.billing.invoiceId as string;
    const items = created.body.data.items as Array<{ id: string; labTestId: string }>;
    structuredItemId = items.find((item) => item.labTestId === testIds[0])!.id;
    fileItemId = items.find((item) => item.labTestId === testIds[1])!.id;
    expect(created.body.data.billing).toMatchObject({
      status: 'ISSUED',
      total: '300.00',
      due: '300.00',
    });
    expect(created.body.data.canWork).toBe(false);
    const catalogBody = {
      code: 'CATALOG-PERMISSION-TEST',
      name: { uz: 'Catalog permission test' },
      parameters: [{ name: 'Result', valueType: 'TEXT' }],
    };
    expect((await post('/lab-tests', reception).send(catalogBody)).status).toBe(403);
    const catalogCreated = await post('/lab-tests', owner).send(catalogBody);
    expect(catalogCreated.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .patch(`${API}/lab-tests/${catalogCreated.body.data.id as string}`)
          .set('Authorization', `Bearer ${reception.accessToken}`)
          .set('x-branch-id', clinic.branchId)
          .send({ name: { uz: 'Unauthorized catalogue edit' } })
      ).status,
    ).toBe(403);
    expect((await post('/lab-catalog/import', reception).send({ codes: ['CBC'] })).status).toBe(
      403,
    );

    expect((await get('/lab-orders')).body.data).toEqual([]);
    expect((await get(`/lab-orders?patientId=${patientId}`, reception)).body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orderId, canWork: false })]),
    );
    expect(
      (
        await post(`/lab-orders/${orderId}/status`, reception).send({
          status: 'SPECIMEN_COLLECTED',
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(`/lab-orders/${orderId}/status`).send({ status: 'SPECIMEN_COLLECTED' })).status,
    ).toBe(409);
    expect(
      (
        await post(`/lab-orders/items/${structuredItemId}/results`).send({
          values: [{ parameterId: parameterIds[0], value: '1' }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(`/lab-orders/${orderId}/attachments`).attach('file', PDF, {
          filename: 'unpaid.pdf',
          contentType: 'application/pdf',
        })
      ).status,
    ).toBe(409);
  });

  it('requires full payment and collection before results can be saved', async () => {
    expect((await pay('100')).status).toBe(201);
    expect(
      (await post(`/lab-orders/${orderId}/status`).send({ status: 'SPECIMEN_COLLECTED' })).status,
    ).toBe(409);
    expect((await pay('200')).status).toBe(201);
    expect((await get('/lab-orders')).body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orderId, canWork: true })]),
    );
    expect(
      (
        await post(`/lab-orders/items/${structuredItemId}/results`).send({
          values: [{ parameterId: parameterIds[0], value: '1' }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await post(`/lab-orders/${orderId}/status`).send({ status: 'SPECIMEN_COLLECTED' })).status,
    ).toBe(201);
  });

  it('marks partial parameter entry as RESULTED and rejects a report owned by another order', async () => {
    const partial = await post(`/lab-orders/items/${structuredItemId}/results`).send({
      values: [{ parameterId: parameterIds[0], value: '1' }],
    });
    expect(partial.status).toBe(201);
    expect(partial.body.data.status).toBe('RESULTED');
    expect(
      (
        await post(`/lab-orders/items/${structuredItemId}/results`).send({
          values: [{ parameterId: parameterIds[1], value: '2' }],
        })
      ).status,
    ).toBe(201);
    const wrongDocument = await prisma.patientDocument.create({
      data: {
        clinicId: clinic.clinicId,
        patientId,
        title: 'Unrelated report',
        fileName: 'unrelated.pdf',
        fileKey: `test/${randomUUID()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
      },
    });
    expect(
      (
        await post(`/lab-orders/items/${fileItemId}/results`).send({
          values: [],
          reportDocumentId: wrongDocument.id,
        })
      ).status,
    ).toBe(404);
    expect(await prisma.labResult.count({ where: { orderItemId: fileItemId } })).toBe(0);
  });

  it('completes with an uploaded report, signs once and locks editing, uploading and deletion', async () => {
    const uploaded = await post(`/lab-orders/${orderId}/attachments`).attach('file', PDF, {
      filename: 'laboratory-result.pdf',
      contentType: 'application/pdf',
    });
    expect(uploaded.status).toBe(201);
    reportDocumentId = uploaded.body.data.id as string;
    const result = await post(`/lab-orders/items/${fileItemId}/results`).send({
      values: [],
      reportDocumentId,
    });
    expect(result.status).toBe(201);
    expect(result.body.data.status).toBe('RESULTED');
    const approvals = await Promise.all(
      [1, 2].map(() => post(`/lab-orders/${orderId}/approve`).send({})),
    );
    expect(approvals.map((response) => response.status).sort()).toEqual([201, 409]);
    const persisted = await prisma.labResult.findUniqueOrThrow({
      where: { orderItemId: fileItemId },
    });
    expect(persisted.approvedAt).not.toBeNull();
    expect(persisted.approvedById).toBe(laboratory.user.id);
    expect(
      (await post(`/lab-orders/items/${fileItemId}/results`).send({ values: [], reportDocumentId }))
        .status,
    ).toBe(409);
    expect(
      (
        await post(`/lab-orders/${orderId}/attachments`).attach('file', PDF, {
          filename: 'late.pdf',
          contentType: 'application/pdf',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${API}/patients/documents/${reportDocumentId}`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .set('x-branch-id', clinic.branchId)
      ).status,
    ).toBe(409);
    const attachment = await get(`/lab-orders/${orderId}/attachments/${reportDocumentId}/download`);
    expect(attachment.status).toBe(200);
    expect(attachment.headers['content-type']).toContain('application/pdf');
    const pdf = await get(`/lab-orders/${orderId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await get(`/lab-orders?patientId=${patientId}`, reception)).body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orderId, status: 'APPROVED' })]),
    );
  });

  it('blocks clinical work after a partial refund even when the invoice still says paid', async () => {
    const created = await post('/lab-orders', reception).send({
      patientId,
      branchId: clinic.branchId,
      testIds: [testIds[0]],
    });
    expect(created.status).toBe(201);
    const refundedOrderId = created.body.data.id as string;
    const refundedInvoiceId = created.body.data.billing.invoiceId as string;
    expect(
      (
        await post(`/invoices/${refundedInvoiceId}/payments`, cashier).send({
          amount: '100',
          method: 'CASH',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(201);
    expect((await get(`/lab-orders/${refundedOrderId}`)).body.data.canWork).toBe(true);
    const refund = await post(`/invoices/${refundedInvoiceId}/refunds`, owner).send({
      amount: '20',
      method: 'CASH',
      reason: 'Laboratory partial refund regression',
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.invoice.status).toBe('PAID');
    const detail = await get(`/lab-orders/${refundedOrderId}`);
    expect(detail.body.data.canWork).toBe(false);
    expect(detail.body.data.billing.due).toBe('20.00');
    expect((await get('/lab-orders')).body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: refundedOrderId })]),
    );
    expect(
      (await post(`/lab-orders/${refundedOrderId}/status`).send({ status: 'SPECIMEN_COLLECTED' }))
        .status,
    ).toBe(409);
    expect(
      (
        await post(`/lab-orders/${refundedOrderId}/attachments`).attach('file', PDF, {
          filename: 'refunded.pdf',
          contentType: 'application/pdf',
        })
      ).status,
    ).toBe(409);
  });

  it('creates only one lab order on invoice retry and rolls back an unmapped laboratory service bill', async () => {
    const key = randomUUID();
    const body = {
      patientId,
      branchId: clinic.branchId,
      settle: 'DEBT',
      idempotencyKey: key,
      lines: [{ serviceId: serviceIds[0], quantity: 1, unitPrice: '100' }],
    };
    const created = await post('/invoices/quick', reception).send(body);
    expect(created.status).toBe(201);
    const retried = await post('/invoices/quick', reception).send(body);
    expect(retried.status).toBe(201);
    expect(retried.body.data.invoice.id).toBe(created.body.data.invoice.id);
    expect(
      await prisma.labOrder.count({ where: { invoiceId: created.body.data.invoice.id as string } }),
    ).toBe(1);
    const linked = await prisma.labOrder.findUniqueOrThrow({
      where: { invoiceId: created.body.data.invoice.id as string },
    });
    expect(
      (await post(`/lab-orders/${linked.id}/status`).send({ status: 'CANCELLED' })).status,
    ).toBe(409);
    expect((await post(`/invoices/${linked.invoiceId}/cancel`, owner).send({})).status).toBe(201);
    expect((await get(`/lab-orders/${linked.id}`)).body.data.status).toBe('CANCELLED');

    const category = await prisma.serviceCategory.findFirstOrThrow({
      where: { clinicId: clinic.clinicId, kind: 'LAB' },
    });
    const unmapped = await prisma.service.create({
      data: {
        clinicId: clinic.clinicId,
        categoryId: category.id,
        code: 'NO-LAB-MAPPING',
        name: { uz: 'Mapping test' },
      },
    });
    const before = await prisma.invoice.count({ where: { clinicId: clinic.clinicId } });
    expect(
      (
        await post('/invoices/quick', reception).send({
          ...body,
          idempotencyKey: randomUUID(),
          lines: [{ serviceId: unmapped.id, quantity: 1, unitPrice: '100' }],
        })
      ).status,
    ).toBe(400);
    expect(await prisma.invoice.count({ where: { clinicId: clinic.clinicId } })).toBe(before);
  });
});
