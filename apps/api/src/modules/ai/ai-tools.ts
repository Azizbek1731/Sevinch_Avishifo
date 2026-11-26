import { Injectable } from '@nestjs/common';
import type { AuthUser, Permission } from '@avishifo/shared';
import { TenantContext } from '../../core/prisma/tenant-context';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { DoctorActivityService } from '../reports/doctor-activity.service';
import { LabReferralReportService } from '../reports/lab-referral-report.service';
import { CashflowService } from '../reports/cashflow.service';
import { AmbulatoryService } from '../ambulatory/ambulatory.service';
import { DoctorPayGateService } from '../auth/doctor-pay-gate.service';

/**
 * What the model is allowed to ask for, and nothing else.
 *
 * No tool takes a clinic id. Every tool runs inside the request's existing
 * tenant context from the verified JWT.
 */

export interface AiToolParameter {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description: string;
  enum?: string[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, AiToolParameter>;
  required: string[];
  /** All of these must be held. */
  permissions: Permission[];
  /** If set, the caller must hold at least one. */
  anyOf?: Permission[];
  identifiable?: boolean;
  run: (args: Record<string, unknown>, user: AuthUser) => Promise<unknown>;
}

function limitOf(args: Record<string, unknown>, fallback = 10, max = 50): number {
  const n = Number(args.limit);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback;
}

function dateOf(value: unknown, fallback: string): string {
  const s = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const RANGE_PARAMS: Record<string, AiToolParameter> = {
  from: { type: 'string', description: 'Boshlanish sanasi, YYYY-MM-DD (Toshkent)' },
  to: { type: 'string', description: 'Tugash sanasi, YYYY-MM-DD (Toshkent)' },
};

@Injectable()
export class AiToolRegistry {
  constructor(
    private readonly reports: ReportsService,
    private readonly doctorActivity: DoctorActivityService,
    private readonly labReferrals: LabReferralReportService,
    private readonly cashflow: CashflowService,
    private readonly ambulatory: AmbulatoryService,
    private readonly doctorPayGate: DoctorPayGateService,
    private readonly prisma: PrismaService,
  ) {}

  forUser(user: AuthUser): AiToolDefinition[] {
    const held = new Set(user.permissions);
    return this.all().filter((t) => {
      if (!t.permissions.every((p) => held.has(p))) return false;
      if (t.anyOf?.length && !t.anyOf.some((p) => held.has(p))) return false;
      return true;
    });
  }

  byName(name: string, user: AuthUser): AiToolDefinition | null {
    return this.forUser(user).find((t) => t.name === name) ?? null;
  }

  private branchOf(user: AuthUser): string | undefined {
    return user.branchIds[0];
  }

  private all(): AiToolDefinition[] {
    return [
      {
        name: 'clinic_today',
        description:
          'Bugungi holat: tushum, yakunlangan tashriflar, navbat, yangi bemorlar, ochiq smenalar.',
        parameters: {},
        required: [],
        permissions: ['reports.read'],
        run: () => this.reports.dashboard({ branchId: undefined } as never),
      },
      {
        name: 'revenue_report',
        description:
          'Davr bo‘yicha tushum: umumiy summa; dimension=time|category|doctor|method.',
        parameters: {
          ...RANGE_PARAMS,
          groupBy: {
            type: 'string',
            description: 'Vaqt guruhlash',
            enum: ['day', 'week', 'month'],
          },
          dimension: {
            type: 'string',
            description: 'Kesim',
            enum: ['time', 'category', 'doctor', 'method'],
          },
        },
        required: ['from', 'to'],
        permissions: ['reports.read'],
        run: (a) =>
          this.reports.revenue({
            from: dateOf(a.from, daysAgo(30)),
            to: dateOf(a.to, today()),
            groupBy: ['day', 'week', 'month'].includes(String(a.groupBy))
              ? (a.groupBy as 'day' | 'week' | 'month')
              : 'day',
            dimension: ['time', 'category', 'doctor', 'method'].includes(String(a.dimension))
              ? (a.dimension as 'time' | 'category' | 'doctor' | 'method')
              : 'time',
          } as never),
      },
      {
        name: 'patient_flow',
        description: 'Bemorlar oqimi: yangi/qaytgan, kelish soatlari, murojaat manbalari.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.read'],
        run: (a) =>
          this.reports.patientFlow({
            from: dateOf(a.from, daysAgo(30)),
            to: dateOf(a.to, today()),
          } as never),
      },
      {
        name: 'doctor_performance',
        description:
          'Shifokorlar kesimida: bemorlar, tashriflar, tushum, o‘rtacha vaqt, ulush foizi.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.read', 'staff.read'],
        run: (a) =>
          this.reports.doctors({
            from: dateOf(a.from, daysAgo(30)),
            to: dateOf(a.to, today()),
          } as never),
      },
      {
        name: 'service_sales',
        description:
          'Xizmatlar ro‘yxati: har bir xizmat guruhi (LAB/UZI/EXO/…), necha marta, nechta bemor, summa.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.read', 'services.read'],
        run: (a) =>
          this.reports.services({
            from: dateOf(a.from, daysAgo(30)),
            to: dateOf(a.to, today()),
          } as never),
      },
      {
        name: 'service_detail',
        description:
          'TO‘LIQ xizmat hisoboti: Lab, UZI, EXO va boshqa guruhlar alohida (soni, bemorlar, summa); ' +
          'har bir xizmat; bemorlar bo‘yicha qatorlar (kimga nima yozilgan/fakturalangan). ' +
          '«Qancha laboratoriya», «UZI nechta», «qaysi bemorga nima» savollarida SHU toolni ishlating.',
        parameters: {
          ...RANGE_PARAMS,
          group: {
            type: 'string',
            description: 'Ixtiyoriy filtr: LAB, UZI, EXO, CONSULTATION, PROCEDURE, DIAGNOSTICS, OTHER',
          },
        },
        required: ['from', 'to'],
        permissions: ['reports.read'],
        identifiable: true,
        run: async (a) => {
          const raw = await this.reports.serviceDetail({
            from: dateOf(a.from, daysAgo(7)),
            to: dateOf(a.to, today()),
          } as never);
          const capped = this.reports.capServiceDetailLines(raw, 80);
          const group = String(a.group ?? '')
            .trim()
            .toUpperCase();
          if (!group) return capped;
          return {
            ...capped,
            byGroup: capped.byGroup.filter((g) => g.group === group),
            byService: capped.byService.filter((s) => s.group === group),
            lines: capped.lines.filter((l) => l.group === group),
          };
        },
      },
      {
        name: 'doctor_activity',
        description:
          'Bitta shifokor hisoboti: qabullar, lab/UZI/EXO yo‘llanmalari summasi va soni, ' +
          'bemorlar ro‘yxati qisqacha. Shifokor o‘z hisobotini so‘rasa doctorUserId shart emas.',
        parameters: {
          ...RANGE_PARAMS,
          doctorUserId: {
            type: 'string',
            description: 'Shifokor user id (admin uchun). Bo‘sh = joriy foydalanuvchi.',
          },
        },
        required: ['from', 'to'],
        permissions: [],
        anyOf: ['reports.read', 'reports.own.read'],
        identifiable: true,
        run: async (a, user) => {
          const branchId = this.branchOf(user);
          if (!branchId) return { error: 'branch_missing' };
          await this.doctorPayGate.assertUnlocked(user);
          return this.doctorActivity.report(
            {
              from: dateOf(a.from, daysAgo(7)),
              to: dateOf(a.to, today()),
              groupBy: 'day',
              doctorUserId: a.doctorUserId ? String(a.doctorUserId) : undefined,
              branchId,
            },
            user,
            branchId,
          );
        },
      },
      {
        name: 'lab_referrals',
        description:
          'Shifokorlar bo‘yicha lab/UZI yo‘llanmalari: kim qancha yuborgan, summalar.',
        parameters: {
          ...RANGE_PARAMS,
          doctorUserId: { type: 'string', description: 'Ixtiyoriy shifokor filtri' },
        },
        required: ['from', 'to'],
        permissions: ['reports.read'],
        run: (a, user) => {
          const branchId = this.branchOf(user);
          if (!branchId) return Promise.resolve({ error: 'branch_missing' });
          return this.labReferrals.report(
            {
              from: dateOf(a.from, daysAgo(30)),
              to: dateOf(a.to, today()),
              groupBy: 'day',
              doctorUserId: a.doctorUserId ? String(a.doctorUserId) : undefined,
              branchId,
            },
            user,
            branchId,
          );
        },
      },
      {
        name: 'ambulatory_share',
        description:
          'Ambulator ulush (foiz pullar): shifokorlar, yo‘llanmalar, Lab/UZI/EXO ulushlari.',
        parameters: {
          ...RANGE_PARAMS,
          doctorUserId: { type: 'string', description: 'Ixtiyoriy shifokor' },
        },
        required: ['from', 'to'],
        permissions: ['ambulatory.read'],
        identifiable: true,
        run: async (a, user) => {
          const branchId = this.branchOf(user);
          if (!branchId) return { error: 'branch_missing' };
          await this.doctorPayGate.assertUnlocked(user);
          return this.ambulatory.commissions(
            {
              from: dateOf(a.from, daysAgo(7)),
              to: dateOf(a.to, today()),
              doctorUserId: a.doctorUserId ? String(a.doctorUserId) : undefined,
            },
            user,
            branchId,
          );
        },
      },
      {
        name: 'cashflow_report',
        description: 'Kassa hisoboti: kirim/chiqim, to‘lov usullari, kunlik yig‘indi.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.cash.read'],
        run: (a, user) => {
          const branchId = this.branchOf(user);
          if (!branchId) return Promise.resolve({ error: 'branch_missing' });
          return this.cashflow.report(
            {
              from: dateOf(a.from, daysAgo(7)),
              to: dateOf(a.to, today()),
              groupBy: 'day',
              branchId,
            },
            user,
            branchId,
          );
        },
      },
      {
        name: 'queue_stats',
        description: 'Navbat: o‘rtacha kutish/xizmat vaqti, talonlar.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.read', 'queue.read'],
        run: (a) =>
          this.reports.queue({
            from: dateOf(a.from, daysAgo(7)),
            to: dateOf(a.to, today()),
          } as never),
      },
      {
        name: 'lab_turnaround',
        description: 'Laboratoriya navbati: buyurtmadan natijagacha o‘rtacha soat, testlar soni.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.read', 'lab.orders.read'],
        run: (a) =>
          this.reports.labTurnaround({
            from: dateOf(a.from, daysAgo(30)),
            to: dateOf(a.to, today()),
          } as never),
      },
      {
        name: 'cashier_shifts',
        description: 'Kassa smenalari: ochilish/yopilish, kutilgan/haqiqiy naqd.',
        parameters: RANGE_PARAMS,
        required: ['from', 'to'],
        permissions: ['reports.read', 'shifts.manage'],
        run: (a) =>
          this.reports.cashierShifts({
            from: dateOf(a.from, daysAgo(30)),
            to: dateOf(a.to, today()),
          } as never),
      },
      {
        name: 'top_debtors',
        description: 'Eng ko‘p qarzi bor bemorlar (ism, MRN, summa). Faqat qarz savollarida.',
        parameters: {
          limit: { type: 'integer', description: '1–50, standart 10' },
        },
        required: [],
        permissions: ['debts.read', 'patients.read'],
        identifiable: true,
        run: async (a) => {
          const rows = await this.prisma.db.patient.findMany({
            where: { balance: { lt: 0 }, deletedAt: null },
            orderBy: { balance: 'asc' },
            take: limitOf(a),
            select: { mrn: true, fullName: true, phone: true, balance: true },
          });
          return rows.map((r) => ({
            mrn: r.mrn,
            fullName: r.fullName,
            phone: r.phone,
            debt: r.balance.abs().toString(),
          }));
        },
      },
      {
        name: 'count_patients',
        description: 'Klinikadagi bemorlar soni (ixtiyoriy sana oralig‘i).',
        parameters: RANGE_PARAMS,
        required: [],
        permissions: ['patients.read'],
        run: async (a) => {
          const from = a.from ? new Date(`${dateOf(a.from, daysAgo(30))}T00:00:00Z`) : undefined;
          const to = a.to ? new Date(`${dateOf(a.to, today())}T23:59:59Z`) : undefined;
          const total = await this.prisma.db.patient.count({
            where: {
              deletedAt: null,
              ...(from || to
                ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
                : {}),
            },
          });
          return { total };
        },
      },
      {
        name: 'appointments_on_day',
        description: 'Bir kundagi qabullar soni holat bo‘yicha.',
        parameters: {
          date: { type: 'string', description: 'Sana, YYYY-MM-DD' },
        },
        required: ['date'],
        permissions: ['appointments.read'],
        run: async (a) => {
          const day = dateOf(a.date, today());
          const rows = await this.prisma.db.appointment.groupBy({
            by: ['status'],
            where: {
              startAt: {
                gte: new Date(`${day}T00:00:00+05:00`),
                lt: new Date(`${day}T23:59:59+05:00`),
              },
            },
            _count: { _all: true },
          });
          return {
            date: day,
            byStatus: rows.map((r) => ({ status: r.status, count: r._count._all })),
          };
        },
      },
      {
        name: 'staff_list',
        description: 'Xodimlar: ism, lavozim, holat.',
        parameters: {},
        required: [],
        permissions: ['staff.read'],
        identifiable: true,
        run: async () => {
          const rows = await this.prisma.db.user.findMany({
            where: { deletedAt: null },
            select: { id: true, fullName: true, role: true, status: true },
            orderBy: { fullName: 'asc' },
            take: 100,
          });
          return rows;
        },
      },
    ];
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    user: AuthUser,
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const tool = this.byName(name, user);
    if (!tool) return { ok: false, error: 'unknown_or_not_permitted' };
    TenantContext.requireClinicId();
    try {
      return { ok: true, data: await tool.run(args, user) };
    } catch {
      return { ok: false, error: 'tool_failed' };
    }
  }
}
