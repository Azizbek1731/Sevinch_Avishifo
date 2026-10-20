/** Daily clinic backup clock: 02:00 Asia/Tashkent, including after a missed boot. */

export const BACKUP_TIME_ZONE = 'Asia/Tashkent';
export const BACKUP_HOUR = 2;

export function zonedParts(date, timeZone = BACKUP_TIME_ZONE) {
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
  const parts = {};
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

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Calendar day of the latest 02:00 Tashkent instant that has already arrived. */
export function backupSlot(date = new Date(), hour = BACKUP_HOUR, timeZone = BACKUP_TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  let { year, month, day } = parts;
  if (parts.hour < hour) {
    const previous = new Date(Date.UTC(year, month - 1, day));
    previous.setUTCDate(previous.getUTCDate() - 1);
    year = previous.getUTCFullYear();
    month = previous.getUTCMonth() + 1;
    day = previous.getUTCDate();
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Milliseconds until the next 02:00. Exactly 02:00:00 waits a full day,
 * because that instant belongs to the slot `backupIfDue` has just handled.
 */
export function msUntilNextBackup(date = new Date(), hour = BACKUP_HOUR, timeZone = BACKUP_TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  let minutes = hour * 60 - (parts.hour * 60 + parts.minute);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes * 60_000 - parts.second * 1000;
}

export function formatTashkent(date, timeZone = BACKUP_TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.day)}.${pad(parts.month)}.${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function backupFileStamp(date = new Date(), timeZone = BACKUP_TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}${pad(parts.month)}${pad(parts.day)}-${pad(parts.hour)}${pad(parts.minute)}`;
}
