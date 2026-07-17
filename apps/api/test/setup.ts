/**
 * Shared e2e harness: boots the real AppModule in-process (real Postgres on
 * localhost:5433 + Redis on 6379), mirroring the global setup from main.ts —
 * minus Swagger, helmet and the Redis Socket.IO adapter (the default in-memory
 * adapter is enough for HTTP tests).
 *
 * Every suite seeds its OWN uniquely-suffixed clinic/branch/users so the demo
 * seed data is never touched or depended upon.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module';

// Repo-root .env (DATABASE_URL etc.) — same files AppConfigModule loads.
loadDotenv({ path: [resolve(__dirname, '../../../.env.local'), resolve(__dirname, '../../../.env')] });

export const PASSWORD = 'E2ePass123!';
export const API = '/api/v1';

// ---------------------------------------------------------------- app boot

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  // Mirror main.ts: cookie parsing + API prefix. Global pipes/guards/filters/
  // interceptors are wired through APP_* providers inside AppModule already.
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  // trust proxy lets each test present a unique X-Forwarded-For source IP so
  // the per-IP login throttle (10/min) never trips across sequential suites.
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);

  await app.init();
  return app;
}

// ---------------------------------------------------------------- seeding

export interface TestUser {
  id: string;
  email: string;
  phone: string;
}

export interface TestClinic {
  clinicId: string;
  branchId: string;
  tag: string;
  owner: TestUser;
  receptionist: TestUser;
  doctor: TestUser;
  cashier: TestUser;
}

let phoneSeq = 0;

/** Unique normalized +998 phone per call (77-prefix is unused by the demo seed). */
export function uniquePhone(): string {
  phoneSeq += 1;
  const base = (Date.now() % 1_000_000) * 10 + (phoneSeq % 10);
  return `+99877${String(base % 10_000_000).padStart(7, '0')}`;
}

/**
 * Seeds an isolated clinic: 1 branch + owner/receptionist/doctor/cashier users
 * (argon2id-hashed PASSWORD, unique emails/phones via the run suffix).
 */
export async function createTestClinic(prisma: PrismaClient, suffix: string): Promise<TestClinic> {
  const tag = `${suffix}-${randomUUID().slice(0, 8)}`;
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const clinic = await prisma.clinic.create({
    data: {
      name: `E2E Clinic ${tag}`,
      status: 'ACTIVE',
      settings: { invoiceNumberFormat: 'INV-{YYYY}-{NNNNNN}', visitLockHours: 24 },
    },
  });
  const branch = await prisma.branch.create({
    data: { clinicId: clinic.id, name: `E2E Branch ${tag}`, address: 'Test street 1' },
  });

  async function mkUser(role: 'CLINIC_OWNER' | 'RECEPTIONIST' | 'DOCTOR' | 'CASHIER'): Promise<TestUser> {
    const email = `${role.toLowerCase().replace('_', '-')}.${tag}@e2e.avishifo.test`;
    const phone = uniquePhone();
    const user = await prisma.user.create({
      data: {
        clinicId: clinic.id,
        email,
        phone,
        passwordHash,
        fullName: `E2E ${role} ${tag}`,
        role,
        locale: 'uz',
      },
    });
    await prisma.userBranch.create({
      data: { clinicId: clinic.id, userId: user.id, branchId: branch.id },
    });
    return { id: user.id, email, phone };
  }

  return {
    clinicId: clinic.id,
    branchId: branch.id,
    tag,
    owner: await mkUser('CLINIC_OWNER'),
    receptionist: await mkUser('RECEPTIONIST'),
    doctor: await mkUser('DOCTOR'),
    cashier: await mkUser('CASHIER'),
  };
}

// ---------------------------------------------------------------- auth utils

let ipSeq = 0;

/** Unique source IP per call — defeats the per-IP auth throttle in tests. */
export function uniqueIp(): string {
  ipSeq += 1;
  return `10.99.${Math.floor(ipSeq / 200) % 200}.${(ipSeq % 200) + 1}`;
}

export interface LoginResult {
  accessToken: string;
  /** Full Set-Cookie strings from the login response. */
  cookies: string[];
  /** "avishifo_rt=<token>" pair ready for a Cookie request header. */
  refreshCookie: string;
  user: { id: string; role: string; clinicId: string | null };
}

export function setCookies(res: Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === 'string' ? [raw] : [];
}

export function refreshCookieOf(res: Response): string {
  const cookie = setCookies(res).find((c) => c.startsWith('avishifo_rt='));
  if (!cookie) throw new Error('No avishifo_rt cookie in response');
  return cookie.split(';')[0] as string;
}

export async function login(
  app: INestApplication,
  identifier: string,
  password: string = PASSWORD,
): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post(`${API}/auth/login`)
    .set('X-Forwarded-For', uniqueIp())
    .send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login(${identifier}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    accessToken: res.body.data.accessToken as string,
    cookies: setCookies(res),
    refreshCookie: refreshCookieOf(res),
    user: res.body.data.user as LoginResult['user'],
  };
}
