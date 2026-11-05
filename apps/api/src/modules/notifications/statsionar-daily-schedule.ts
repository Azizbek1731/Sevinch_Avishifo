/** Daily statsionar Excel: 16:30 Asia/Tashkent, including catch-up after a missed boot. */

export const STATSIONAR_REPORT_TZ = 'Asia/Tashkent';
export const STATSIONAR_REPORT_HOUR = 16;
export const STATSIONAR_REPORT_MINUTE = 30;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function zonedParts(date: Date, timeZone = STATSIONAR_REPORT_TZ): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function targetMinutes(): number {
  return STATSIONAR_REPORT_HOUR * 60 + STATSIONAR_REPORT_MINUTE;
}

/** Calendar day of the latest 16:30 Tashkent instant that has already arrived. */
export function statsionarReportSlot(
  date = new Date(),
  timeZone = STATSIONAR_REPORT_TZ,
): string {
  const parts = zonedParts(date, timeZone);
  let { year, month, day } = parts;
  const nowMins = parts.hour * 60 + parts.minute;
  if (nowMins < targetMinutes()) {
    const previous = new Date(Date.UTC(year, month - 1, day));
    previous.setUTCDate(previous.getUTCDate() - 1);
    year = previous.getUTCFullYear();
    month = previous.getUTCMonth() + 1;
    day = previous.getUTCDate();
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Milliseconds until the next 16:30. Exactly 16:30:00 waits a full day,
 * because that instant belongs to the slot just handled.
 */
export function msUntilNextStatsionarReport(
  date = new Date(),
  timeZone = STATSIONAR_REPORT_TZ,
): number {
  const parts = zonedParts(date, timeZone);
  let minutes = targetMinutes() - (parts.hour * 60 + parts.minute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes * 60_000 - parts.second * 1000;
}

export function formatStatsionarStamp(date = new Date(), timeZone = STATSIONAR_REPORT_TZ): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(parts.hour)}${pad(parts.minute)}`;
}
