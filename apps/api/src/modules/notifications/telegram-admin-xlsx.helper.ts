import { formatInTimeZone } from 'date-fns-tz';
import { TIMEZONE } from '@avishifo/shared';
import { XlsxService, type SheetSpec } from '../reports/xlsx.service';
import { tashkentDayBounds } from './statsionar-xlsx.helper';

const EXPORT_ROW_CAP = 10_000;

type JsonName = { uz?: string; ru?: string; en?: string } | string | null;

type ExportDb = {
  patient: {
    findMany: (args: unknown) => Promise<
      Array<{
        mrn: string;
        fullName: string;
        phone: string | null;
        dob: Date | null;
        gender: string | null;
        careType: string;
        address: string | null;
        tags: string[];
        balance: { toFixed: (n: number) => string } | string | number;
        createdAt: Date;
      }>
    >;
  };
  invoice: {
    findMany: (args: unknown) => Promise<
      Array<{
        number: string;
        status: string;
        total: { toFixed: (n: number) => string } | string | number;
        paidTotal: { toFixed: (n: number) => string } | string | number;
        discountTotal: { toFixed: (n: number) => string } | string | number;
        createdAt: Date;
        issuedAt: Date | null;
        note: string | null;
        patient: { mrn: string; fullName: string; phone: string | null } | null;
        lines: Array<{
          title: JsonName;
          quantity: number;
          unitPrice: { toFixed: (n: number) => string } | string | number;
          lineTotal: { toFixed: (n: number) => string } | string | number;
        }>;
        payments: Array<{
          method: string;
          amount: { toFixed: (n: number) => string } | string | number;
          status: string;
          paidAt: Date;
          voidedAt: Date | null;
        }>;
      }>
    >;
  };
  payment: {
    findMany: (args: unknown) => Promise<
      Array<{
        method: string;
        amount: { toFixed: (n: number) => string } | string | number;
        status: string;
        paidAt: Date;
        voidedAt: Date | null;
        invoice: {
          number: string;
          patient: { mrn: string; fullName: string } | null;
        } | null;
      }>
    >;
  };
};

function money(value: { toFixed: (n: number) => string } | string | number | null | undefined): string {
  if (value == null) return '0.00';
  if (typeof value === 'object' && 'toFixed' in value) return value.toFixed(2);
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function stampLocal(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function lineTitle(title: JsonName): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  return title.uz || title.ru || title.en || '';
}

function invoiceStatusUz(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'Qoralama',
    UNPAID: "To'lanmagan",
    PARTIAL: 'Qisman',
    PAID: "To'langan",
    VOID: 'Bekor',
    REFUNDED: 'Qaytarilgan',
  };
  return map[status] ?? status;
}

function paymentMethodUz(method: string): string {
  const map: Record<string, string> = {
    CASH: 'Naqd',
    CARD: 'Karta',
    CLICK: 'Click',
    BALANCE: 'Balans',
  };
  return map[method] ?? method;
}

function ageFromDob(dob: Date | null, now = new Date()): string {
  if (!dob) return '';
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? String(age) : '';
}

/** Full ambulatory + inpatient patient roster for admin Telegram. */
export async function buildPatientsXlsx(
  db: ExportDb,
  xlsx: XlsxService,
): Promise<{ buffer: Buffer; count: number; filename: string }> {
  const rows = await db.patient.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_ROW_CAP,
  });
  const sheet: SheetSpec = {
    name: 'Bemorlar',
    columns: [
      { header: 'MRN', key: 'mrn', width: 14 },
      { header: 'F.I.Sh.', key: 'fullName', width: 28 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: "Tug'ilgan sana", key: 'dob', width: 14 },
      { header: 'Yosh', key: 'age', width: 8 },
      { header: 'Jinsi', key: 'gender', width: 10 },
      { header: 'Davolash turi', key: 'careType', width: 14 },
      { header: 'Manzil', key: 'address', width: 28 },
      { header: 'Teglar', key: 'tags', width: 20 },
      { header: 'Balans', key: 'balance', width: 14, money: true },
      { header: "Ro'yxatga olingan", key: 'createdAt', width: 18 },
    ],
    rows: rows.map((p) => ({
      mrn: p.mrn,
      fullName: p.fullName,
      phone: p.phone ?? '',
      dob: p.dob ? formatInTimeZone(p.dob, TIMEZONE, 'yyyy-MM-dd') : '',
      age: ageFromDob(p.dob),
      gender: p.gender === 'MALE' ? 'Erkak' : p.gender === 'FEMALE' ? 'Ayol' : p.gender ?? '',
      careType: p.careType === 'INPATIENT' ? 'Statsionar' : 'Ambulator',
      address: p.address ?? '',
      tags: (p.tags ?? []).join(', '),
      balance: money(p.balance),
      createdAt: stampLocal(p.createdAt),
    })),
  };
  const day = formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return {
    buffer: await xlsx.buildWorkbook([sheet]),
    count: rows.length,
    filename: `bemorlar-${day}.xlsx`,
  };
}

/** Invoices created on a Tashkent calendar day (header + lines sheets). */
export async function buildDailyInvoicesXlsx(
  db: ExportDb,
  xlsx: XlsxService,
  asOfDate: string,
): Promise<{ buffer: Buffer; count: number; filename: string }> {
  const { start, end } = tashkentDayBounds(asOfDate);
  const invoices = await db.invoice.findMany({
    where: { createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'asc' },
    take: EXPORT_ROW_CAP,
    include: {
      patient: { select: { mrn: true, fullName: true, phone: true } },
      lines: true,
      payments: {
        where: { status: 'COMPLETED', voidedAt: null },
        orderBy: { paidAt: 'asc' },
      },
    },
  });

  const header: SheetSpec = {
    name: 'Fakturalar',
    columns: [
      { header: 'Raqam', key: 'number', width: 16 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'MRN', key: 'mrn', width: 14 },
      { header: 'Bemor', key: 'patient', width: 28 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Jami', key: 'total', width: 12, money: true },
      { header: "To'langan", key: 'paid', width: 12, money: true },
      { header: 'Chegirma', key: 'discount', width: 12, money: true },
      { header: 'Qarz', key: 'due', width: 12, money: true },
      { header: 'Yaratilgan', key: 'createdAt', width: 18 },
      { header: 'Izoh', key: 'note', width: 24 },
    ],
    rows: invoices.map((inv) => {
      const total = money(inv.total);
      const paid = money(inv.paidTotal);
      const due = (Number(total) - Number(paid)).toFixed(2);
      return {
        number: inv.number,
        status: invoiceStatusUz(inv.status),
        mrn: inv.patient?.mrn ?? '',
        patient: inv.patient?.fullName ?? '',
        phone: inv.patient?.phone ?? '',
        total,
        paid,
        discount: money(inv.discountTotal),
        due,
        createdAt: stampLocal(inv.createdAt),
        note: inv.note ?? '',
      };
    }),
  };

  const lines: SheetSpec = {
    name: 'Qatorlar',
    columns: [
      { header: 'Faktura', key: 'number', width: 16 },
      { header: 'Bemor', key: 'patient', width: 28 },
      { header: 'Xizmat', key: 'title', width: 36 },
      { header: 'Soni', key: 'qty', width: 8 },
      { header: 'Narx', key: 'unitPrice', width: 12, money: true },
      { header: 'Jami', key: 'lineTotal', width: 12, money: true },
    ],
    rows: invoices.flatMap((inv) =>
      inv.lines.map((line) => ({
        number: inv.number,
        patient: inv.patient?.fullName ?? '',
        title: lineTitle(line.title),
        qty: String(line.quantity),
        unitPrice: money(line.unitPrice),
        lineTotal: money(line.lineTotal),
      })),
    ),
  };

  const payments: SheetSpec = {
    name: "To'lovlar (fakturadan)",
    columns: [
      { header: 'Faktura', key: 'number', width: 16 },
      { header: 'Bemor', key: 'patient', width: 28 },
      { header: 'Usul', key: 'method', width: 12 },
      { header: 'Summa', key: 'amount', width: 12, money: true },
      { header: 'Vaqt', key: 'paidAt', width: 18 },
    ],
    rows: invoices.flatMap((inv) =>
      inv.payments.map((p) => ({
        number: inv.number,
        patient: inv.patient?.fullName ?? '',
        method: paymentMethodUz(p.method),
        amount: money(p.amount),
        paidAt: stampLocal(p.paidAt),
      })),
    ),
  };

  return {
    buffer: await xlsx.buildWorkbook([header, lines, payments]),
    count: invoices.length,
    filename: `fakturalar-${asOfDate}.xlsx`,
  };
}

/** Completed (non-void) payments on a Tashkent calendar day. */
export async function buildDailyPaymentsXlsx(
  db: ExportDb,
  xlsx: XlsxService,
  asOfDate: string,
): Promise<{ buffer: Buffer; count: number; filename: string; total: string }> {
  const { start, end } = tashkentDayBounds(asOfDate);
  const payments = await db.payment.findMany({
    where: {
      status: 'COMPLETED',
      voidedAt: null,
      paidAt: { gte: start, lte: end },
    },
    orderBy: { paidAt: 'asc' },
    take: EXPORT_ROW_CAP,
    include: {
      invoice: {
        select: {
          number: true,
          patient: { select: { mrn: true, fullName: true } },
        },
      },
    },
  });

  let sum = 0;
  const rows = payments.map((p) => {
    const amount = money(p.amount);
    sum += Number(amount);
    return {
      paidAt: stampLocal(p.paidAt),
      method: paymentMethodUz(p.method),
      amount,
      invoice: p.invoice?.number ?? '',
      mrn: p.invoice?.patient?.mrn ?? '',
      patient: p.invoice?.patient?.fullName ?? '',
    };
  });

  const byMethod = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const cur = byMethod.get(row.method) ?? { amount: 0, count: 0 };
    cur.amount += Number(row.amount);
    cur.count += 1;
    byMethod.set(row.method, cur);
  }

  const detail: SheetSpec = {
    name: "To'lovlar",
    columns: [
      { header: 'Vaqt', key: 'paidAt', width: 18 },
      { header: 'Usul', key: 'method', width: 12 },
      { header: 'Summa', key: 'amount', width: 12, money: true },
      { header: 'Faktura', key: 'invoice', width: 16 },
      { header: 'MRN', key: 'mrn', width: 14 },
      { header: 'Bemor', key: 'patient', width: 28 },
    ],
    rows,
  };

  const summary: SheetSpec = {
    name: 'Jami',
    columns: [
      { header: 'Usul', key: 'method', width: 14 },
      { header: 'Amaliyotlar', key: 'count', width: 12 },
      { header: 'Summa', key: 'amount', width: 14, money: true },
    ],
    rows: [
      ...[...byMethod.entries()].map(([method, v]) => ({
        method,
        count: String(v.count),
        amount: v.amount.toFixed(2),
      })),
      { method: 'JAMI', count: String(rows.length), amount: sum.toFixed(2) },
    ],
  };

  return {
    buffer: await xlsx.buildWorkbook([detail, summary]),
    count: rows.length,
    total: sum.toFixed(2),
    filename: `tolovlar-${asOfDate}.xlsx`,
  };
}
