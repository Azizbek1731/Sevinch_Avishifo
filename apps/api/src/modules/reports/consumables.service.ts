import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  ErrorCode,
  TIMEZONE,
  type AuthUser,
  type ConsumablesKind,
  type ConsumablesQueryInput,
  type ConsumablesReport,
} from '@avishifo/shared';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TenantContext } from '../../core/prisma/tenant-context';
import { AuditService } from '../../core/audit/audit.service';
import { cashflowRangeUtc } from './cashflow.service';
import { XlsxService, type SheetSpec } from './xlsx.service';

export interface ConsumablesAggregateRow {
  bucket: string;
  serviceId: string | null;
  code: string | null;
  title: Record<string, string>;
  kind: ConsumablesKind;
  unit: string;
  ordered: boolean;
  quantity: string;
  amount: string;
  entries: number;
}

const blankAmounts = () => ({ amount: '0.00', orderedAmount: '0.00', entries: 0, orderedEntries: 0 });
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const titleText = (title: Record<string, string>) => title.uz || title.ru || title.en || Object.values(title).find(Boolean) || '—';

/** Never combine different units or count ordered quantities as observed consumption. */
export function summarizeConsumables(rows: ConsumablesAggregateRow[]): Pick<ConsumablesReport, 'totals' | 'units' | 'items' | 'periods'> {
  const totals = { ...blankAmounts(), itemCount: 0 };
  const items = new Map<string, ConsumablesReport['items'][number]>();
  const units = new Map<string, ConsumablesReport['units'][number]>();
  const periods = new Map<string, ConsumablesReport['periods'][number]>();
  for (const row of rows) {
    const unit = normalized(row.unit);
    const key = JSON.stringify([row.serviceId ? 'catalog' : 'manual', row.serviceId ?? normalized(titleText(row.title)), row.kind, unit]);
    const item = items.get(key) ?? {
      key, serviceId: row.serviceId, code: row.code, title: row.title, kind: row.kind, unit,
      quantity: '0.000', orderedQuantity: '0.000', ...blankAmounts(),
    };
    const unitTotal = units.get(unit) ?? { unit, quantity: '0.000', orderedQuantity: '0.000' };
    const period = periods.get(row.bucket) ?? { bucket: row.bucket, ...blankAmounts() };
    const quantityField = row.ordered ? 'orderedQuantity' : 'quantity';
    const amountField = row.ordered ? 'orderedAmount' : 'amount';
    const entriesField = row.ordered ? 'orderedEntries' : 'entries';
    item[quantityField] = new Prisma.Decimal(item[quantityField]).add(row.quantity).toFixed(3);
    unitTotal[quantityField] = new Prisma.Decimal(unitTotal[quantityField]).add(row.quantity).toFixed(3);
    for (const aggregate of [item, period, totals]) {
      aggregate[amountField] = new Prisma.Decimal(aggregate[amountField]).add(row.amount).toFixed(2);
      aggregate[entriesField] += row.entries;
    }
    items.set(key, item);
    units.set(unit, unitTotal);
    periods.set(row.bucket, period);
  }
  totals.itemCount = items.size;
  return {
    totals,
    items: [...items.values()].sort((a, b) => titleText(a.title).localeCompare(titleText(b.title)) || a.key.localeCompare(b.key)),
    units: [...units.values()].sort((a, b) => a.unit.localeCompare(b.unit)),
    periods: [...periods.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
}

@Injectable()
export class ConsumablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly xlsx: XlsxService,
  ) {}

  async report(q: ConsumablesQueryInput, user: AuthUser, activeBranchId: string): Promise<ConsumablesReport> {
    if (!user.permissions.includes('reports.cash.read')) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing permission: reports.cash.read', 403);
    }
    const branchId = q.branchId ?? activeBranchId;
    if (user.branchIds.length > 0 && !user.branchIds.includes(branchId)) {
      throw new AppException(ErrorCode.FORBIDDEN, 'No access to this branch', 403);
    }
    const clinicId = TenantContext.requireClinicId();
    const { start, end } = cashflowRangeUtc(q.from, q.to);
    const filters: Prisma.Sql[] = [];
    if (q.kind) filters.push(Prisma.sql`kind = ${q.kind}`);
    if (q.source) filters.push(Prisma.sql`source = ${q.source}`);
    const filterSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    // One statement = one snapshot. Raw SQL bypasses tenancy middleware, so every
    // arm and join is explicitly clinic-scoped. Payment/refund status never
    // determines physical usage. All values are saved patient tariffs, not costs.
    const rows = await this.prisma.db.$queryRaw<ConsumablesAggregateRow[]>(Prisma.sql`
      WITH usage AS (
        SELECT (e."createdAt" AT TIME ZONE ${TIMEZONE})::date AS date,
               e."serviceId", s.code, e.title::jsonb AS title,
               CASE WHEN sc.kind::text = 'MEDICINE' OR e.kind::text = 'ANESTHESIA'
                    THEN 'MEDICINE' ELSE 'MATERIAL' END AS kind,
               e.unit, 'SURGERY'::text AS source, false AS ordered,
               e.quantity::numeric AS quantity, ROUND(c."unitPrice" * c.quantity, 2) AS amount
        FROM "SurgeryEntry" e
        JOIN "SurgeryCase" op ON op.id = e."surgeryId" AND op."clinicId" = ${clinicId}
          AND op."branchId" = ${branchId} AND op.status::text <> 'CANCELLED'
        JOIN "ChargeItem" c ON c.id = e."chargeItemId" AND c."clinicId" = ${clinicId}
          AND c."branchId" = ${branchId} AND c.status::text <> 'CANCELLED'
        LEFT JOIN "Service" s ON s.id = e."serviceId" AND s."clinicId" = ${clinicId}
        LEFT JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        WHERE e."clinicId" = ${clinicId} AND e."createdAt" >= ${start} AND e."createdAt" < ${end}
        UNION ALL
        SELECT c.date, c."serviceId", s.code, c.title::jsonb, sc.kind::text, s.unit,
               CASE WHEN c."admissionId" IS NULL THEN 'OUTPATIENT' ELSE 'INPATIENT' END,
               false, c.quantity::numeric, ROUND(c."unitPrice" * c.quantity, 2)
        FROM "ChargeItem" c
        JOIN "Service" s ON s.id = c."serviceId" AND s."clinicId" = ${clinicId}
        JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        WHERE c."clinicId" = ${clinicId} AND c."branchId" = ${branchId}
          AND c.status::text <> 'CANCELLED' AND sc.kind::text IN ('MEDICINE', 'MATERIAL')
          AND c.date >= ${q.from}::date AND c.date <= ${q.to}::date
          AND c."administrationId" IS NULL AND c."surgeryId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "SurgeryEntry" e WHERE e."chargeItemId" = c.id AND e."clinicId" = ${clinicId})
          AND NOT EXISTS (SELECT 1 FROM "SurgeryCase" op WHERE op."serviceChargeId" = c.id AND op."clinicId" = ${clinicId})
          AND NOT EXISTS (SELECT 1 FROM "TreatmentOrder" o WHERE o."billingChargeId" = c.id AND o."clinicId" = ${clinicId})
        UNION ALL
        SELECT a.date, o."serviceId", s.code, COALESCE(lc.title, bc.title, s.name)::jsonb,
               sc.kind::text, s.unit, 'INPATIENT', false, 1::numeric,
               ROUND(CASE WHEN o."billedOnOrder" THEN bc."unitPrice" ELSE lc."unitPrice" * lc.quantity END, 2)
        FROM "TreatmentAdministration" a
        JOIN "TreatmentOrder" o ON o.id = a."orderId" AND o."clinicId" = ${clinicId}
        JOIN "Admission" adm ON adm.id = o."admissionId" AND adm."clinicId" = ${clinicId}
          AND adm."branchId" = ${branchId}
        JOIN "Service" s ON s.id = o."serviceId" AND s."clinicId" = ${clinicId}
        JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        LEFT JOIN "ChargeItem" lc ON lc."administrationId" = a.id AND lc."clinicId" = ${clinicId}
          AND lc."branchId" = ${branchId}
        LEFT JOIN "ChargeItem" bc ON bc.id = o."billingChargeId" AND bc."clinicId" = ${clinicId}
          AND bc."branchId" = ${branchId}
        WHERE a."clinicId" = ${clinicId} AND a.status::text = 'GIVEN'
          AND sc.kind::text IN ('MEDICINE', 'MATERIAL')
          AND a.date >= ${q.from}::date AND a.date <= ${q.to}::date
          AND ((o."billedOnOrder" AND bc.status::text <> 'CANCELLED')
            OR (NOT o."billedOnOrder" AND lc.status::text <> 'CANCELLED'))
        UNION ALL
        SELECT c.date, o."serviceId", s.code, c.title::jsonb, sc.kind::text, s.unit,
               'INPATIENT', true, c.quantity::numeric, ROUND(c."unitPrice" * c.quantity, 2)
        FROM "TreatmentOrder" o
        JOIN "Admission" adm ON adm.id = o."admissionId" AND adm."clinicId" = ${clinicId}
          AND adm."branchId" = ${branchId}
        JOIN "ChargeItem" c ON c.id = o."billingChargeId" AND c."clinicId" = ${clinicId}
          AND c."branchId" = ${branchId} AND c.status::text <> 'CANCELLED'
        JOIN "Service" s ON s.id = o."serviceId" AND s."clinicId" = ${clinicId}
        JOIN "ServiceCategory" sc ON sc.id = s."categoryId" AND sc."clinicId" = ${clinicId}
        WHERE o."clinicId" = ${clinicId} AND o."billedOnOrder"
          AND sc.kind::text IN ('MEDICINE', 'MATERIAL')
          AND c.date >= ${q.from}::date AND c.date <= ${q.to}::date
      )
      SELECT to_char(date_trunc(${q.groupBy}, date::timestamp), 'YYYY-MM-DD') AS bucket,
             "serviceId", code, title, kind, unit, ordered,
             SUM(quantity)::text AS quantity, SUM(amount)::text AS amount, COUNT(*)::int AS entries
      FROM usage ${filterSql}
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      ORDER BY 1, 2, 3, 4, 5, 6, 7
    `);
    return {
      from: q.from, to: q.to, branchId, timezone: TIMEZONE, groupBy: q.groupBy,
      kind: q.kind ?? null, source: q.source ?? null, ...summarizeConsumables(rows),
    };
  }

  sheets(report: ConsumablesReport): SheetSpec[] {
    const kindLabel = (kind: string) => kind === 'MEDICINE' ? 'Dorilar' : 'Materiallar';
    const sourceLabel = { SURGERY: 'Operatsiya', INPATIENT: 'Statsionar', OUTPATIENT: 'Ambulator' };
    const amountColumns = [
      { header: 'Sarf qiymati (tarif)', key: 'amount', money: true },
      { header: 'Sarf yozuvlari', key: 'entries' },
      { header: 'Tayinlangan qiymat (alohida)', key: 'orderedAmount', money: true, width: 30 },
      { header: 'Tayinlovlar', key: 'orderedEntries' },
    ];
    return [
      {
        name: 'Davr va hisoblash',
        columns: [{ header: 'Parametr', key: 'key', width: 30 }, { header: 'Qiymat', key: 'value', width: 110 }],
        rows: [
          { key: 'Boshlanish', value: report.from }, { key: 'Tugash (shu kun ham)', value: report.to },
          { key: 'Filial ID', value: report.branchId }, { key: 'Vaqt mintaqasi', value: report.timezone },
          { key: 'Guruhlash', value: report.groupBy },
          { key: 'Tur', value: report.kind ? kindLabel(report.kind) : 'Dorilar va materiallar' },
          { key: 'Manba', value: report.source ? sourceLabel[report.source] : 'Barcha manbalar' },
          { key: 'Qamrov', value: 'Tanlangan filial, barcha xodimlar. Bekor qilingan sarflar kiritilmaydi.' },
          { key: 'Sarf', value: 'Operatsiyada kiritilgan sarflar, katalogdagi dori/material xarajatlari va berilgan deb belgilangan tayinlovlar.' },
          { key: 'Tayinlangan', value: 'Oldindan hisoblangan tayinlovlarning to‘liq miqdori alohida ko‘rsatiladi; sarfga qo‘shilmaydi va berilgan miqdor undan ayrilmaydi.' },
          { key: 'Qiymat', value: 'Bemor hisobiga kiritilgan tarif bo‘yicha qiymat. Xarid narxi, ombor tannarxi yoki kassaga kelgan pul emas.' },
          { key: 'Sanalar', value: 'Operatsiya sarfi: kiritilgan mahalliy kun. Xarajat va tayinlov: hisob sanasi. Berilgan tayinlov: belgilangan kun.' },
          { key: 'Cheklovlar', value: 'Retseptlar, muolaja tarkibidagi taxminiy sarflar va katalogsiz umumiy xarajatlar kiritilmaydi. Operatsiyadagi qo‘lda kiritilgan material/dorilar kiritiladi.' },
          { key: 'Birliklar', value: 'Turli o‘lchov birliklari qo‘shilmaydi va o‘zaro aylantirilmaydi.' },
        ],
      },
      { name: 'Jami', columns: [{ header: 'Nomenklatura soni', key: 'itemCount', width: 22 }, ...amountColumns], rows: [{ ...report.totals }] },
      {
        name: 'Birliklar', columns: [
          { header: 'Birlik', key: 'unit' }, { header: 'Sarf miqdori', key: 'quantity', quantity: true },
          { header: 'Tayinlangan (alohida)', key: 'orderedQuantity', quantity: true, width: 24 },
        ], rows: report.units.map((row) => ({ ...row })),
      },
      {
        name: 'Dorilar va materiallar', columns: [
          { header: 'Kod', key: 'code' }, { header: 'Nomi', key: 'name', width: 42 }, { header: 'Tur', key: 'kind' },
          { header: 'Birlik', key: 'unit' }, { header: 'Sarf miqdori', key: 'quantity', quantity: true },
          { header: 'Tayinlangan (alohida)', key: 'orderedQuantity', quantity: true, width: 24 }, ...amountColumns,
        ], rows: report.items.map((row) => ({ ...row, name: titleText(row.title), kind: kindLabel(row.kind) })),
      },
      { name: 'Davrlar', columns: [{ header: 'Davr boshlanishi', key: 'bucket', width: 22 }, ...amountColumns], rows: report.periods.map((row) => ({ ...row })) },
    ];
  }

  async export(report: ConsumablesReport, user: AuthUser): Promise<Buffer> {
    if (!user.permissions.includes('reports.cash.export')) {
      throw new AppException(ErrorCode.FORBIDDEN, 'Missing permission: reports.cash.export', 403);
    }
    await this.audit.log({
      action: AuditAction.EXPORT, entity: 'Report', entityId: 'consumables',
      after: { from: report.from, to: report.to, branchId: report.branchId, groupBy: report.groupBy, kind: report.kind, source: report.source },
    });
    return this.xlsx.buildWorkbook(this.sheets(report));
  }
}
