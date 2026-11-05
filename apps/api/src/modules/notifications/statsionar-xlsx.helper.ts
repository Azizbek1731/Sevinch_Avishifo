import { XlsxService, type SheetSpec } from '../reports/xlsx.service';

const EXPORT_ROW_CAP = 10_000;

/** Minimal Prisma surface used by the export (works with tenant-extended clients). */
type AdmissionClient = {
  admission: {
    findMany: (args: unknown) => Promise<
      Array<{
        historyNumber: string;
        attendingDoctorUserId: string | null;
        attendingDoctorName: string | null;
        department: string | null;
        ward: string | null;
        bed: string | null;
        status: string;
        admittedAt: Date;
        dischargedAt: Date | null;
        patient: { mrn: string; fullName: string } | null;
      }>
    >;
  };
  user: {
    findMany: (args: unknown) => Promise<Array<{ id: string; fullName: string }>>;
  };
};

/** Asia/Tashkent inclusive day bounds for a YYYY-MM-DD calendar date. */
export function tashkentDayBounds(ymd: string): { start: Date; end: Date } {
  return {
    start: new Date(`${ymd}T00:00:00.000+05:00`),
    end: new Date(`${ymd}T23:59:59.999+05:00`),
  };
}

/** Parse user-entered date → YYYY-MM-DD, or null if invalid. */
export function parseStatsionarReportDate(raw: string): string | null {
  const text = raw.trim();
  let y = 0;
  let m = 0;
  let d = 0;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else {
    return null;
  }
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatStatsionarReportDateUz(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Statsionar roster as XLSX.
 * - Without `asOfDate`: current ACTIVE stays (daily 16:30 snapshot).
 * - With `asOfDate` (YYYY-MM-DD, Tashkent): everyone who was inpatient that calendar day.
 */
export async function buildActiveStatsionarXlsx(
  db: AdmissionClient,
  xlsx: XlsxService,
  asOfDate?: string,
): Promise<{ buffer: Buffer; count: number }> {
  const where = asOfDate
    ? (() => {
        const { start, end } = tashkentDayBounds(asOfDate);
        return {
          admittedAt: { lte: end },
          OR: [{ dischargedAt: null }, { dischargedAt: { gte: start } }],
        };
      })()
    : { status: 'ACTIVE' };

  const rows = await db.admission.findMany({
    where,
    orderBy: { admittedAt: 'desc' },
    take: EXPORT_ROW_CAP,
    include: {
      patient: { select: { id: true, mrn: true, fullName: true, dob: true, gender: true } },
    },
  });

  const doctorIds = [
    ...new Set(
      rows
        .map((r) => r.attendingDoctorUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const doctors = doctorIds.length
    ? await db.user.findMany({
        where: { id: { in: doctorIds } },
        select: { id: true, fullName: true },
      })
    : [];
  const doctorById = new Map(doctors.map((d) => [d.id, d.fullName]));

  const asOfEnd = asOfDate ? tashkentDayBounds(asOfDate).end.getTime() : Date.now();
  const asOfStart = asOfDate ? tashkentDayBounds(asOfDate).start.getTime() : null;

  const sheet: SheetSpec = {
    name: 'Statsionar',
    columns: [
      { header: 'Tarix №', key: 'historyNumber', width: 16 },
      { header: 'MRN', key: 'mrn', width: 14 },
      { header: 'Bemor', key: 'patientName', width: 28 },
      { header: 'Shifokor', key: 'doctor', width: 28 },
      { header: "Bo'lim", key: 'department', width: 18 },
      { header: 'Xona', key: 'ward', width: 14 },
      { header: "O'rin", key: 'bed', width: 10 },
      { header: 'Holat', key: 'status', width: 12 },
      { header: 'Yotqizilgan', key: 'admittedAt', width: 20 },
      { header: 'Chiqarilgan', key: 'dischargedAt', width: 20 },
      { header: 'Kun', key: 'days', width: 8, quantity: true },
    ],
    rows: rows.map((row) => {
      const admittedAt = row.admittedAt.toISOString();
      const dischargedAt = row.dischargedAt ? row.dischargedAt.toISOString() : null;
      const from = row.admittedAt.getTime();
      const leaveAt = row.dischargedAt ? row.dischargedAt.getTime() : null;
      const to =
        leaveAt !== null && leaveAt < asOfEnd ? leaveAt : asOfEnd;
      const days = Math.max(1, Math.ceil((to - from) / 86_400_000));
      const leftThatDay =
        asOfStart !== null &&
        leaveAt !== null &&
        leaveAt >= asOfStart &&
        leaveAt <= asOfEnd;
      const stillIn =
        leaveAt === null || leaveAt > asOfEnd;
      const statusLabel = asOfDate
        ? leftThatDay
          ? 'Chiqarilgan'
          : stillIn
            ? 'Yotibdi'
            : 'Yotibdi'
        : 'Yotibdi';
      const doctorName =
        (row.attendingDoctorUserId
          ? doctorById.get(row.attendingDoctorUserId)
          : null) ??
        row.attendingDoctorName ??
        '';
      return {
        historyNumber: row.historyNumber,
        mrn: row.patient?.mrn ?? '',
        patientName: row.patient?.fullName ?? '',
        doctor: doctorName,
        department: row.department ?? '',
        ward: row.ward ?? '',
        bed: row.bed ?? '',
        status: statusLabel,
        admittedAt: admittedAt.slice(0, 16).replace('T', ' '),
        dischargedAt: dischargedAt ? dischargedAt.slice(0, 16).replace('T', ' ') : '',
        days: String(days),
      };
    }),
  };

  const buffer = await xlsx.buildWorkbook([sheet]);
  return { buffer, count: rows.length };
}
