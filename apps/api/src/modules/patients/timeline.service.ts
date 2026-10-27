import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { paginated, skipTake, type PaginatedResult } from '../../common/pagination';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PatientsService } from './patients.service';
import type { TimelineType } from './dto';

export interface TimelineItem {
  type: TimelineType;
  /** ISO timestamp the item is sorted by. */
  at: string;
  title: string;
  data: Record<string, unknown>;
}

export interface TimelineQuery {
  page: number;
  limit: number;
  type?: TimelineType;
  doctorUserId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientsService,
  ) {}

  /**
   * Chronological medical-history feed: visits (with diagnoses+prescriptions),
   * lab orders, documents and payments — merged in memory, newest first.
   */
  async getTimeline(
    patientId: string,
    query: TimelineQuery,
  ): Promise<PaginatedResult<TimelineItem>> {
    await this.patients.requirePatient(patientId);

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
    const range: Prisma.DateTimeFilter | undefined =
      from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined;
    const doctorUserId = query.doctorUserId;
    const want = (t: TimelineType): boolean => !query.type || query.type === t;

    const items: TimelineItem[] = [];

    if (want('visit')) {
      const visits = await this.prisma.db.visit.findMany({
        where: {
          patientId,
          ...(doctorUserId && { doctorUserId }),
          ...(range && { startedAt: range }),
        },
        include: {
          doctor: { select: { fullName: true } },
          diagnoses: { include: { icd10: { select: { code: true, nameUz: true, nameRu: true } } } },
          prescriptions: true,
        },
      });
      for (const v of visits) {
        items.push({
          type: 'visit',
          at: v.startedAt.toISOString(),
          title: `Visit — ${v.doctor.fullName}`,
          data: {
            visitId: v.id,
            status: v.status,
            doctorUserId: v.doctorUserId,
            doctorName: v.doctor.fullName,
            startedAt: v.startedAt.toISOString(),
            completedAt: v.completedAt?.toISOString() ?? null,
            diagnoses: v.diagnoses.map((d) => ({
              id: d.id,
              icd10Code: d.icd10.code,
              name: d.icd10.nameUz,
              isPrimary: d.isPrimary,
            })),
            prescriptions: v.prescriptions.map((p) => ({
              id: p.id,
              drugName: p.drugName,
              dosage: p.dosage,
              frequency: p.frequency,
              durationDays: p.durationDays,
            })),
          },
        });
      }
    }

    if (want('diagnosis')) {
      const diagnoses = await this.prisma.db.diagnosis.findMany({
        where: {
          visit: { patientId, ...(doctorUserId && { doctorUserId }) },
          ...(range && { createdAt: range }),
        },
        include: {
          icd10: { select: { code: true, nameUz: true, nameRu: true } },
          visit: { select: { id: true, doctorUserId: true } },
        },
      });
      for (const d of diagnoses) {
        items.push({
          type: 'diagnosis',
          at: d.createdAt.toISOString(),
          title: `${d.icd10.code} — ${d.icd10.nameUz}`,
          data: {
            diagnosisId: d.id,
            visitId: d.visit.id,
            doctorUserId: d.visit.doctorUserId,
            icd10Code: d.icd10.code,
            nameUz: d.icd10.nameUz,
            nameRu: d.icd10.nameRu,
            isPrimary: d.isPrimary,
            note: d.note,
          },
        });
      }
    }

    if (want('prescription')) {
      const prescriptions = await this.prisma.db.prescription.findMany({
        where: {
          visit: { patientId, ...(doctorUserId && { doctorUserId }) },
          ...(range && { createdAt: range }),
        },
        include: { visit: { select: { id: true, doctorUserId: true } } },
      });
      for (const p of prescriptions) {
        items.push({
          type: 'prescription',
          at: p.createdAt.toISOString(),
          title: p.drugName,
          data: {
            prescriptionId: p.id,
            visitId: p.visit.id,
            doctorUserId: p.visit.doctorUserId,
            drugName: p.drugName,
            dosage: p.dosage,
            frequency: p.frequency,
            durationDays: p.durationDays,
            instructions: p.instructions,
          },
        });
      }
    }

    if (want('lab')) {
      const orders = await this.prisma.db.labOrder.findMany({
        where: {
          patientId,
          ...(doctorUserId && { visit: { doctorUserId } }),
          ...(range && { createdAt: range }),
        },
        include: {
          items: {
            include: {
              labTest: { select: { code: true, name: true } },
              result: { select: { approvedAt: true } },
            },
          },
        },
      });
      for (const o of orders) {
        const approvedAts = o.items
          .map((i) => i.result?.approvedAt)
          .filter((d): d is Date => d instanceof Date);
        const approvedAt =
          approvedAts.length > 0
            ? new Date(Math.max(...approvedAts.map((d) => d.getTime()))).toISOString()
            : null;
        items.push({
          type: 'lab',
          at: o.createdAt.toISOString(),
          title: `Lab order ${o.orderNumber}`,
          data: {
            labOrderId: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            approvedAt,
            tests: o.items.map((i) => {
              const raw = i.labTest.name as
                | string
                | { uz?: string | null; ru?: string | null; en?: string | null }
                | null;
              const name =
                typeof raw === 'string'
                  ? raw
                  : raw && typeof raw === 'object'
                    ? raw.uz || raw.ru || raw.en || i.labTest.code
                    : i.labTest.code;
              return { code: i.labTest.code, name };
            }),
          },
        });
      }
    }

    if (want('document')) {
      const docs = await this.prisma.db.patientDocument.findMany({
        where: { patientId, ...(range && { createdAt: range }) },
      });
      for (const d of docs) {
        items.push({
          type: 'document',
          at: d.createdAt.toISOString(),
          title: d.title,
          data: {
            documentId: d.id,
            category: d.category,
            fileName: d.fileName,
            mimeType: d.mimeType,
            sizeBytes: d.sizeBytes,
          },
        });
      }
    }

    if (want('payment')) {
      const payments = await this.prisma.db.payment.findMany({
        where: { invoice: { patientId }, ...(range && { paidAt: range }) },
        include: { invoice: { select: { id: true, number: true } } },
      });
      for (const p of payments) {
        items.push({
          type: 'payment',
          at: p.paidAt.toISOString(),
          title: `Payment for invoice ${p.invoice.number}`,
          data: {
            paymentId: p.id,
            invoiceId: p.invoice.id,
            invoiceNumber: p.invoice.number,
            amount: p.amount.toFixed(2),
            method: p.method,
            status: p.status,
          },
        });
      }
    }

    // ISO-8601 UTC strings sort lexicographically — newest first.
    items.sort((a, b) => b.at.localeCompare(a.at));
    const total = items.length;
    const { skip, take } = skipTake(query);
    return paginated(items.slice(skip, skip + take), {
      page: query.page,
      limit: query.limit,
      total,
    });
  }
}
