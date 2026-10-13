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
  type LoginResult,
  type TestClinic,
} from './setup';

/**
 * The standard laboratory catalogue, and the reference intervals a clinic ends
 * up flagging its patients against.
 *
 * Two properties carry this feature. The first is tenancy: the catalogue is a
 * dictionary every clinic reads and none owns, so an import is a COPY — the
 * moment one clinic retunes an interval to its own analyser, that retuning must
 * be invisible to the dictionary and to every other clinic. The second is that
 * a stored flag and the interval it came from can never drift apart: correcting
 * the physiological state on an order has to re-flag the numbers already typed,
 * or the report carries a right value under a wrong word.
 *
 * The catalogue is seeded by migration, so its codes are used where a real
 * dictionary makes the test stronger. Everything that asserts a FLAG runs
 * against a lab test the suite creates with intervals it controls — a future
 * correction to the published norms must not turn this suite red.
 */
describe('lab catalogue and reference intervals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let ownerA: LoginResult;
  let ownerB: LoginResult;
  let recepA: LoginResult;

  /** Codes the suite imports. All four are seeded by the catalogue migration. */
  const CODES = ['CBC', 'THYROID_PANEL', 'COAGULOGRAM', 'LIPID_PROFILE'];

  const authA = (t: LoginResult) => ({
    Authorization: `Bearer ${t.accessToken}`,
    'x-branch-id': clinicA.branchId,
  });
  const authB = (t: LoginResult) => ({
    Authorization: `Bearer ${t.accessToken}`,
    'x-branch-id': clinicB.branchId,
  });

  /** Look a parameter up by analyte code, failing loudly rather than silently. */
  const byCode = <T extends { code: string }>(params: T[]) => {
    const map = new Map(params.map((p) => [p.code, p]));
    return (code: string): T => {
      const found = map.get(code);
      if (!found) throw new Error(`parameter ${code} missing from the response`);
      return found;
    };
  };

  /** A date `years` before today, as the Patient.dob column stores it. */
  const yearsAgo = (years: number): Date => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return new Date(d.toISOString().slice(0, 10));
  };

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
    clinicA = await createTestClinic(prisma, 'labcat-a');
    clinicB = await createTestClinic(prisma, 'labcat-b');
    ownerA = await login(app, clinicA.owner.email);
    ownerB = await login(app, clinicB.owner.email);
    recepA = await login(app, clinicA.receptionist.email);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function linkFreeService(labTestId: string): Promise<void> {
    const category = await prisma.serviceCategory.create({
      data: { clinicId: clinicA.clinicId, name: 'Reference range fixture', kind: 'LAB' },
    });
    const service = await prisma.service.create({
      data: {
        clinicId: clinicA.clinicId,
        categoryId: category.id,
        code: `FREE-${randomUUID()}`,
        name: { uz: 'Reference range test' },
        prices: {
          create: {
            clinicId: clinicA.clinicId,
            price: '0',
            effectiveFrom: new Date(Date.now() - 60_000),
          },
        },
      },
    });
    await prisma.labTest.update({ where: { id: labTestId }, data: { serviceId: service.id } });
  }

  // ------------------------------------------------------------- browsing

  it('serves the seeded catalogue with its parameters', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .set(authA(ownerA))
      .expect(200);

    expect(res.body.meta.total).toBeGreaterThan(50);
    const first = res.body.data[0];
    expect(first).toMatchObject({
      code: expect.any(String),
      biomaterial: expect.any(String),
      category: expect.any(String),
      name: { uz: expect.any(String), ru: expect.any(String) },
    });
    expect(first.parameters.length).toBe(first.parameterCount);
    // A fresh clinic carries none of it yet.
    expect(res.body.data.every((t: { imported: boolean }) => t.imported === false)).toBe(true);
  });

  it('filters by biomaterial', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ biomaterial: 'URINE', limit: 100 })
      .set(authA(ownerA))
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((t: { biomaterial: string }) => t.biomaterial === 'URINE')).toBe(
      true,
    );
    expect(res.body.data.some((t: { code: string }) => t.code === 'URINALYSIS')).toBe(true);
  });

  it('filters by category', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ category: 'HORMONES', limit: 100 })
      .set(authA(ownerA))
      .expect(200);

    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((t: { category: string }) => t.category === 'HORMONES')).toBe(true);
    expect(res.body.data.some((t: { code: string }) => t.code === 'THYROID_PANEL')).toBe(true);
  });

  it('finds a panel by the name of an analyte inside it', async () => {
    // Nobody orders "the complete blood count" when they want haemoglobin —
    // they type HGB, and the search has to reach into the panel's parameters.
    const byAnalyte = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ search: 'HGB', limit: 100 })
      .set(authA(ownerA))
      .expect(200);
    expect(byAnalyte.body.data.some((t: { code: string }) => t.code === 'CBC')).toBe(true);

    const byName = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ search: 'Гемоглобин', limit: 100 })
      .set(authA(ownerA))
      .expect(200);
    expect(byName.body.data.some((t: { code: string }) => t.code === 'CBC')).toBe(true);

    // And by the test's own code, which must not have been broken by the above.
    const byTestCode = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ search: 'coagulogram' })
      .set(authA(ownerA))
      .expect(200);
    expect(byTestCode.body.data.some((t: { code: string }) => t.code === 'COAGULOGRAM')).toBe(true);
  });

  it('summarises the catalogue for the import dialog', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-catalog/summary`)
      .set(authA(ownerA))
      .expect(200);

    const { total, importedCount, biomaterials, categories } = res.body.data;
    expect(total).toBeGreaterThan(50);
    expect(importedCount).toBe(0); // nothing imported into clinic A yet
    const blood = biomaterials.find((b: { value: string }) => b.value === 'BLOOD');
    expect(blood.count).toBeGreaterThan(0);
    const hematology = categories.find((c: { value: string }) => c.value === 'HEMATOLOGY');
    expect(hematology.count).toBeGreaterThan(0);
    // The per-biomaterial counts have to add up to the whole catalogue.
    const summed = biomaterials.reduce((n: number, b: { count: number }) => n + b.count, 0);
    expect(summed).toBe(total);
  });

  it('is the same dictionary for every clinic', async () => {
    const page = async (auth: Record<string, string>, p: number) => {
      const res = await request(app.getHttpServer())
        .get(`${API}/lab-catalog`)
        .query({ page: p, limit: 100 })
        .set(auth)
        .expect(200);
      return res.body.data as Array<{ code: string }>;
    };
    const codesOf = async (auth: Record<string, string>) =>
      [...(await page(auth, 1)), ...(await page(auth, 2))].map((t) => t.code);

    const forA = await codesOf(authA(ownerA));
    const forB = await codesOf(authB(ownerB));
    expect(forA.length).toBeGreaterThan(100);
    expect(forB).toEqual(forA);

    // Same content, not merely the same code list. `imported` is deliberately
    // per-clinic, so it is the one field allowed to differ.
    const detail = async (auth: Record<string, string>) => {
      const res = await request(app.getHttpServer())
        .get(`${API}/lab-catalog/CBC`)
        .set(auth)
        .expect(200);
      const { imported, ...rest } = res.body.data;
      void imported;
      return rest;
    };
    expect(await detail(authB(ownerB))).toEqual(await detail(authA(ownerA)));
  });

  // -------------------------------------------------------------- importing

  it('refuses an import from a caller without services.write', async () => {
    // The receptionist may browse the catalogue — services.read — but stocking
    // the clinic's own analyser menu is not front-desk work.
    await request(app.getHttpServer()).get(`${API}/lab-catalog`).set(authA(recepA)).expect(200);

    await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(authA(recepA))
      .send({ codes: ['CBC'] })
      .expect(403);

    const leaked = await prisma.labTest.count({ where: { clinicId: clinicA.clinicId } });
    expect(leaked).toBe(0);
  });

  it('copies the catalogue tests into the clinic own rows', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(authA(ownerA))
      .send({ codes: CODES })
      .expect(201);

    expect(res.body.data).toMatchObject({ created: CODES.length, updated: 0, skipped: 0 });
    expect(res.body.data.createdCodes.sort()).toEqual([...CODES].sort());
    expect(res.body.data.missingCodes).toEqual([]);

    const cbc = await prisma.labTest.findFirstOrThrow({
      where: { clinicId: clinicA.clinicId, code: 'CBC' },
      include: { parameters: true },
    });
    expect(cbc.catalogCode).toBe('CBC');
    expect(cbc.biomaterial).toBe('BLOOD');
    expect(cbc.category).toBe('HEMATOLOGY');

    // Parameters and their intervals arrive verbatim — the import is a copy, so
    // anything less than "identical" means the clinic starts off flagging its
    // patients against something the dictionary never said.
    const source = await prisma.labCatalogTest.findUniqueOrThrow({
      where: { code: 'CBC' },
      include: { parameters: true },
    });
    expect(cbc.parameters.length).toBe(source.parameters.length);
    for (const src of source.parameters) {
      const copy = cbc.parameters.find((p) => p.code === src.code);
      expect(copy, `parameter ${src.code} was not copied`).toBeTruthy();
      expect(copy?.name).toBe(src.nameUz);
      expect(copy?.unit).toBe(src.unit);
      expect(copy?.valueType).toBe(src.valueType);
      expect(copy?.referenceRanges).toEqual(src.referenceRanges);
      expect(copy?.clinicId).toBe(clinicA.clinicId);
    }

    const summary = await request(app.getHttpServer())
      .get(`${API}/lab-catalog/summary`)
      .set(authA(ownerA))
      .expect(200);
    expect(summary.body.data.importedCount).toBe(CODES.length);
  });

  it('marks what this clinic already carries, and can hide it', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ search: 'CBC' })
      .set(authA(ownerA))
      .expect(200);
    expect(res.body.data.find((t: { code: string }) => t.code === 'CBC').imported).toBe(true);

    const onlyNew = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ search: 'CBC', onlyNew: true })
      .set(authA(ownerA))
      .expect(200);
    expect(onlyNew.body.data.some((t: { code: string }) => t.code === 'CBC')).toBe(false);

    // Clinic B carries nothing, so the same dictionary entry reads as new there.
    const forB = await request(app.getHttpServer())
      .get(`${API}/lab-catalog`)
      .query({ search: 'CBC' })
      .set(authB(ownerB))
      .expect(200);
    expect(forB.body.data.find((t: { code: string }) => t.code === 'CBC').imported).toBe(false);
  });

  it('is safe to press the import button twice', async () => {
    const before = await prisma.labTestParameter.count({
      where: { clinicId: clinicA.clinicId, labTest: { code: 'CBC' } },
    });

    const again = await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(authA(ownerA))
      .send({ codes: CODES })
      .expect(201);
    expect(again.body.data).toMatchObject({ created: 0, updated: 0, skipped: CODES.length });

    expect(await prisma.labTest.count({ where: { clinicId: clinicA.clinicId } })).toBe(
      CODES.length,
    );
    expect(
      await prisma.labTestParameter.count({
        where: { clinicId: clinicA.clinicId, labTest: { code: 'CBC' } },
      }),
    ).toBe(before);
  });

  it('re-copies only when overwriteExisting is asked for', async () => {
    const before = await prisma.labTestParameter.count({
      where: { clinicId: clinicA.clinicId, labTest: { code: 'CBC' } },
    });

    const res = await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(authA(ownerA))
      .send({ codes: ['CBC'], overwriteExisting: true })
      .expect(201);
    expect(res.body.data).toMatchObject({ created: 0, updated: 1, skipped: 0 });

    // Updated in place: matched on the analyte code, so results already filed
    // against a parameter keep pointing at the same row.
    expect(
      await prisma.labTestParameter.count({
        where: { clinicId: clinicA.clinicId, labTest: { code: 'CBC' } },
      }),
    ).toBe(before);
  });

  it('reports codes the catalogue does not have instead of failing the batch', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(authA(ownerA))
      .send({ codes: ['CBC', 'NO_SUCH_TEST_CODE'] })
      .expect(201);
    expect(res.body.data.missingCodes).toEqual(['NO_SUCH_TEST_CODE']);
  });

  // ---------------------------------------------------------------- tenancy

  it('keeps a clinic retuned interval out of the dictionary and out of the other clinic', async () => {
    // This is the property the whole copy-on-import design exists for.
    await request(app.getHttpServer())
      .post(`${API}/lab-catalog/import`)
      .set(authB(ownerB))
      .send({ codes: ['CBC'] })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`${API}/lab-tests`)
      .query({ search: 'CBC' })
      .set(authA(ownerA))
      .expect(200);
    const test = list.body.data.find((t: { code: string }) => t.code === 'CBC');
    const original = test.parameters.find(
      (p: { code: string }) => p.code === 'HGB',
    ).referenceRanges;
    expect(original.length).toBeGreaterThan(1);

    // Clinic A's own analyser says something narrower. Sending the whole
    // parameter list back is also a round-trip check: an interval the catalogue
    // published must be one the clinic can save again unchanged.
    const RETUNED = [{ low: 111, high: 122, label: 'Clinic A analyser' }];
    const parameters = test.parameters.map(
      (p: {
        name: string;
        code: string | null;
        unit: string | null;
        valueType: string;
        referenceRanges: unknown;
        sortOrder: number;
      }) => ({
        name: p.name,
        ...(p.code ? { code: p.code } : {}),
        ...(p.unit ? { unit: p.unit } : {}),
        valueType: p.valueType,
        referenceRanges: p.code === 'HGB' ? RETUNED : p.referenceRanges,
        sortOrder: p.sortOrder,
      }),
    );
    await request(app.getHttpServer())
      .patch(`${API}/lab-tests/${test.id}`)
      .set(authA(ownerA))
      .send({ parameters })
      .expect(200);

    const hgbOf = async (clinicId: string) =>
      (
        await prisma.labTestParameter.findFirstOrThrow({
          where: { clinicId, code: 'HGB', labTest: { code: 'CBC' } },
        })
      ).referenceRanges;

    // Clinic A sees its own edit...
    expect(await hgbOf(clinicA.clinicId)).toEqual(RETUNED);
    // ...the shared dictionary does not...
    const shared = await prisma.labCatalogParameter.findFirstOrThrow({
      where: { code: 'HGB', test: { code: 'CBC' } },
    });
    expect(shared.referenceRanges).toEqual(original);
    // ...and neither does clinic B, whose copy was taken from the same source.
    expect(await hgbOf(clinicB.clinicId)).toEqual(original);

    const asB = await request(app.getHttpServer())
      .get(`${API}/lab-catalog/CBC`)
      .set(authB(ownerB))
      .expect(200);
    expect(
      asB.body.data.parameters.find((p: { code: string }) => p.code === 'HGB').referenceRanges,
    ).toEqual(original);
  });

  // ----------------------------------------------- flagging and order context

  /**
   * A hormone panel the suite owns outright, so the flag assertions below depend
   * on nothing but the intervals written here.
   *
   * TSH and D-dimer are the two directions a pregnancy correction runs in: TSH
   * drops in the second trimester, D-dimer climbs, so the same two numbers read
   * abnormal against the non-pregnant bands and normal against the T2 ones.
   * Potassium carries no state qualifier at all — it is the control.
   */
  describe('order context and auto-flagging', () => {
    let labTestId: string;
    let orderId: string;
    let itemId: string;
    let paramId: Record<string, string>;

    const ADULT_WOMAN = { gender: 'FEMALE', ageMinDays: 6570, ageMaxDays: 23725 } as const;

    beforeAll(async () => {
      const woman = await prisma.patient.create({
        data: {
          clinicId: clinicA.clinicId,
          mrn: `LB-${randomUUID().slice(0, 6)}`,
          firstName: 'Homilador',
          lastName: 'Bemor',
          fullName: 'Homilador Bemor',
          gender: 'FEMALE',
          dob: yearsAgo(30),
        },
      });

      const created = await request(app.getHttpServer())
        .post(`${API}/lab-tests`)
        .set(authA(ownerA))
        .send({
          code: `E2E-HORM-${clinicA.tag}`,
          name: { uz: 'E2E gormonlar paneli' },
          specimenType: 'blood',
          parameters: [
            {
              name: 'TSH',
              code: 'TSH',
              unit: 'µIU/mL',
              valueType: 'NUMERIC',
              referenceRanges: [
                { ...ADULT_WOMAN, low: 0.4, high: 4, label: 'adult women' },
                {
                  gender: 'FEMALE',
                  state: 'PREGNANCY_T2',
                  low: 0.2,
                  high: 3,
                  label: 'pregnancy T2',
                },
              ],
            },
            {
              name: 'D-dimer',
              code: 'DDIMER',
              unit: 'mg/L FEU',
              valueType: 'NUMERIC',
              referenceRanges: [
                { ...ADULT_WOMAN, high: 0.5, label: 'adult women' },
                { gender: 'FEMALE', state: 'PREGNANCY_T2', high: 1.6, label: 'pregnancy T2' },
              ],
            },
            {
              name: 'Kaliy',
              code: 'K',
              unit: 'mmol/L',
              valueType: 'NUMERIC',
              // No qualifier at all: nothing about a pregnancy changes this one.
              referenceRanges: [
                { low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5, label: 'all' },
              ],
            },
            {
              name: 'Izoh',
              code: 'NOTE',
              valueType: 'TEXT',
              referenceRanges: [{ textNorm: 'Salbiy' }],
            },
          ],
        })
        .expect(201);
      labTestId = created.body.data.id;
      await linkFreeService(labTestId);
      paramId = Object.fromEntries(
        created.body.data.parameters.map((p: { code: string; id: string }) => [p.code, p.id]),
      );

      const order = await request(app.getHttpServer())
        .post(`${API}/lab-orders`)
        .set(authA(ownerA))
        .send({ patientId: woman.id, branchId: clinicA.branchId, testIds: [labTestId] })
        .expect(201);
      orderId = order.body.data.id;
      itemId = order.body.data.items[0].id;
      expect(order.body.data.physiologicalState).toBeNull();
      expect(order.body.data.billing.status).toBe('PAID');
      await request(app.getHttpServer())
        .post(`${API}/lab-orders/${orderId}/status`)
        .set(authA(ownerA))
        .send({ status: 'SPECIMEN_COLLECTED' })
        .expect(201);
    });

    const flagsOf = async (): Promise<Record<string, string>> => {
      const values = await prisma.labResultValue.findMany({
        where: { result: { orderItem: { id: itemId } } },
      });
      const byId = Object.fromEntries(Object.entries(paramId).map(([code, id]) => [id, code]));
      return Object.fromEntries(values.map((v) => [byId[v.parameterId] as string, v.flag]));
    };

    it('flags each entered value against the interval that fits this patient', async () => {
      const res = await request(app.getHttpServer())
        .post(`${API}/lab-orders/items/${itemId}/results`)
        .set(authA(ownerA))
        .send({
          values: [
            // Comma decimal — the Uzbek and Russian keyboards produce it.
            { parameterId: paramId.TSH, value: '0,3' },
            { parameterId: paramId.DDIMER, value: '0.9' },
            { parameterId: paramId.K, value: '2.1' },
            { parameterId: paramId.NOTE, value: 'Kuchli musbat' },
          ],
        })
        .expect(201);

      expect(await flagsOf()).toEqual({
        TSH: 'LOW', // 0.3 is under the 0.4 non-pregnant floor
        DDIMER: 'HIGH', // 0.9 is over the 0.5 non-pregnant ceiling
        K: 'CRITICAL_LOW', // 2.1 is under criticalLow 2.5, not merely under 3.5
        NOTE: 'NORMAL', // qualitative — never auto-flagged, whatever it says
      });
      // All items resulted, so the order moved on by itself.
      expect(res.body.data.status).toBe('RESULTED');
    });

    it('exposes the interval it used, per patient, on the order detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`${API}/lab-orders/${orderId}`)
        .set(authA(ownerA))
        .expect(200);

      const param = byCode(
        res.body.data.items[0].labTest.parameters as Array<{
          code: string;
          matchedRange: { label?: string } | null;
          referenceMissing: boolean;
        }>,
      );
      expect(param('TSH').matchedRange).toMatchObject({ label: 'adult women', low: 0.4, high: 4 });
      expect(param('TSH').referenceMissing).toBe(false);
      expect(param('K').matchedRange).toMatchObject({ label: 'all' });
    });

    it('re-flags the numbers already typed when the state is corrected', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${API}/lab-orders/${orderId}/context`)
        .set(authA(ownerA))
        .send({ physiologicalState: 'PREGNANCY_T2' })
        .expect(200);
      expect(res.body.data.physiologicalState).toBe('PREGNANCY_T2');

      // Same numbers, different bands — leaving the old flags in place would put
      // a wrong word next to a right value on a report someone acts on.
      expect(await flagsOf()).toEqual({
        TSH: 'NORMAL', // 0.3 sits inside the 0.2-3.0 second-trimester band
        DDIMER: 'NORMAL', // 0.9 is expected in the second trimester
        K: 'CRITICAL_LOW', // unqualified interval: pregnancy changes nothing
        NOTE: 'NORMAL',
      });

      const param = byCode(
        res.body.data.items[0].labTest.parameters as Array<{
          code: string;
          matchedRange: { label?: string } | null;
        }>,
      );
      expect(param('TSH').matchedRange).toMatchObject({ label: 'pregnancy T2' });
      expect(param('DDIMER').matchedRange).toMatchObject({ label: 'pregnancy T2' });
      expect(param('K').matchedRange).toMatchObject({ label: 'all' });
    });

    it('refuses to restate the context once the report is approved', async () => {
      await request(app.getHttpServer())
        .post(`${API}/lab-orders/${orderId}/approve`)
        .set(authA(ownerA))
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${API}/lab-orders/${orderId}/context`)
        .set(authA(ownerA))
        .send({ physiologicalState: null });
      // That report has been signed and handed over; quietly rewriting its flags
      // is not a correction anyone can see.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAB_INVALID_TRANSITION');

      const order = await prisma.labOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.physiologicalState).toBe('PREGNANCY_T2');
    });

    it('says when an analyte has intervals but none of them covers this patient', async () => {
      // An eight-year-old against a catalogue that only carries infant and adult
      // bands. The tech must be able to tell that from "normal".
      const child = await prisma.patient.create({
        data: {
          clinicId: clinicA.clinicId,
          mrn: `LB-${randomUUID().slice(0, 6)}`,
          firstName: 'Yosh',
          lastName: 'Bemor',
          fullName: 'Yosh Bemor',
          gender: 'MALE',
          dob: yearsAgo(8),
        },
      });

      const created = await request(app.getHttpServer())
        .post(`${API}/lab-tests`)
        .set(authA(ownerA))
        .send({
          code: `E2E-GAP-${clinicA.tag}`,
          name: { uz: 'E2E oraliqli test' },
          parameters: [
            {
              name: 'Gapped',
              code: 'GAP',
              unit: 'g/L',
              referenceRanges: [
                { ageMinDays: 0, ageMaxDays: 365, low: 100, high: 140, label: 'infants' },
                { ageMinDays: 6570, low: 130, high: 160, label: 'adults' },
              ],
            },
            // No intervals at all — a different situation, and it must read as one.
            { name: 'Unmeasured', code: 'NORANGE', referenceRanges: [] },
          ],
        })
        .expect(201);

      await linkFreeService(created.body.data.id as string);
      const order = await request(app.getHttpServer())
        .post(`${API}/lab-orders`)
        .set(authA(ownerA))
        .send({
          patientId: child.id,
          branchId: clinicA.branchId,
          testIds: [created.body.data.id],
        })
        .expect(201);

      const param = byCode(
        order.body.data.items[0].labTest.parameters as Array<{
          id: string;
          code: string;
          matchedRange: unknown;
          referenceMissing: boolean;
        }>,
      );
      expect(param('GAP').matchedRange).toBeNull();
      expect(param('GAP').referenceMissing).toBe(true);
      // "This analyte has no norms" is not the same claim as "the norms miss you".
      expect(param('NORANGE').matchedRange).toBeNull();
      expect(param('NORANGE').referenceMissing).toBe(false);

      await request(app.getHttpServer())
        .post(`${API}/lab-orders/${order.body.data.id as string}/status`)
        .set(authA(ownerA))
        .send({ status: 'SPECIMEN_COLLECTED' })
        .expect(201);

      // With nothing to compare against, nothing is flagged either.
      const entered = await request(app.getHttpServer())
        .post(`${API}/lab-orders/items/${order.body.data.items[0].id}/results`)
        .set(authA(ownerA))
        .send({
          values: [
            { parameterId: param('GAP').id, value: '5' },
            { parameterId: param('NORANGE').id, value: '5' },
          ],
        })
        .expect(201);
      const flags = entered.body.data.items[0].result.values.map((v: { flag: string }) => v.flag);
      expect(flags).toEqual(['NORMAL', 'NORMAL']);
    });
  });
});
