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

describe('queue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinic: TestClinic;
  let recep: LoginResult; // queue.manage
  let doctor: LoginResult; // queue.call
  let patient1Id: string;
  let patient2Id: string;
  let queueId: string;
  let ticket1Id: string;
  let ticket2Id: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createApp();
    clinic = await createTestClinic(prisma, `queue${Date.now()}`);
    recep = await login(app, clinic.receptionist.email);
    doctor = await login(app, clinic.doctor.email);

    const mkPatient = async (first: string) => {
      const res = await request(app.getHttpServer())
        .post(`${API}/patients`)
        .set('Authorization', `Bearer ${recep.accessToken}`)
        .send({ firstName: first, lastName: 'Navbatov', phone: uniquePhone() });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    patient1Id = await mkPatient('Birinchi');
    patient2Id = await mkPatient('Ikkinchi');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('enqueues the first walk-in as ticket 1', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/enqueue`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ patientId: patient1Id, branchId: clinic.branchId, doctorUserId: clinic.doctor.id });

    expect(res.status).toBe(201);
    expect(res.body.data.ticketNumber).toBe('A-001');
    queueId = res.body.data.queueId as string;
    ticket1Id = res.body.data.id as string;
  });

  it('the doctor cannot enqueue (queue.manage belongs to reception)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/enqueue`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({ patientId: patient2Id, branchId: clinic.branchId, doctorUserId: clinic.doctor.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('the receptionist cannot call-next (queue.call belongs to the doctor)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('call-next moves ticket 1 to CALLED', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: ticket1Id,
      ticketNumber: 'A-001',
      status: 'CALLED',
    });
    expect(res.body.data.calledAt).toBeTruthy();
  });

  it('start moves the called ticket to IN_ROOM', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/tickets/${ticket1Id}/start`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('IN_ROOM');
  });

  it('finish moves the ticket to DONE', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/tickets/${ticket1Id}/finish`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DONE');
  });

  it('an invalid jump (start on a DONE ticket) → 409 TICKET_INVALID_TRANSITION', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/tickets/${ticket1Id}/start`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'TICKET_INVALID_TRANSITION' },
    });
  });

  it('the second enqueue gets ticket number 2 in the same queue', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/enqueue`)
      .set('Authorization', `Bearer ${recep.accessToken}`)
      .set('x-branch-id', clinic.branchId)
      .send({ patientId: patient2Id, branchId: clinic.branchId, doctorUserId: clinic.doctor.id });

    expect(res.status).toBe(201);
    expect(res.body.data.ticketNumber).toBe('A-002');
    expect(res.body.data.queueId).toBe(queueId);
    ticket2Id = res.body.data.id as string;
  });

  it('skip + recall re-queues the ticket, then it can be called again', async () => {
    // Call ticket 2, then skip it (patient stepped away).
    const called = await request(app.getHttpServer())
      .post(`${API}/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(called.body.data.id).toBe(ticket2Id);

    const skipped = await request(app.getHttpServer())
      .post(`${API}/queues/tickets/${ticket2Id}/skip`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(skipped.status).toBe(201);
    expect(skipped.body.data.status).toBe('SKIPPED');

    // Recall puts it back to WAITING (queue is otherwise empty → next in line).
    const recalled = await request(app.getHttpServer())
      .post(`${API}/queues/tickets/${ticket2Id}/recall`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(recalled.status).toBe(201);
    expect(recalled.body.data.status).toBe('WAITING');
    expect(recalled.body.data.calledAt).toBeNull();

    const recall2 = await request(app.getHttpServer())
      .post(`${API}/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(recall2.status).toBe(201);
    expect(recall2.body.data).toMatchObject({ id: ticket2Id, status: 'CALLED' });

    const done = await request(app.getHttpServer())
      .post(`${API}/queues/tickets/${ticket2Id}/finish`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(done.body.data.status).toBe('DONE');
  });

  it('call-next on an empty queue → 404 TICKET_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/queues/${queueId}/call-next`)
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
  });

  it('GET /queues shows the day queue with both finished tickets', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/queues`)
      .query({ branchId: clinic.branchId })
      .set('Authorization', `Bearer ${recep.accessToken}`);

    expect(res.status).toBe(200);
    const queue = (res.body.data as Array<{ id: string; tickets: Array<{ status: string }> }>).find(
      (q) => q.id === queueId,
    );
    expect(queue).toBeDefined();
    expect(queue!.tickets).toHaveLength(2);
    expect(queue!.tickets.every((t) => t.status === 'DONE')).toBe(true);
  });
});
