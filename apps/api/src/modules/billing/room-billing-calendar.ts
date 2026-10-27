/** Room fees use rolling 24h periods from the admission instant (Asia/Tashkent labels). */
export const ROOM_BILLING_TIME_ZONE = 'Asia/Tashkent';
export const ROOM_PERIOD_MS = 24 * 60 * 60 * 1000;

export function roomBillingDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ROOM_BILLING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function nextRoomBillingDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function nextRoomPeriodAt(from: Date): Date {
  return new Date(from.getTime() + ROOM_PERIOD_MS);
}

/** Inclusive count of 24h periods from admission through `through`. */
export function roomBillingDayCount(admittedAt: Date, through: Date): number {
  if (through.getTime() < admittedAt.getTime()) return 1;
  return Math.floor((through.getTime() - admittedAt.getTime()) / ROOM_PERIOD_MS) + 1;
}

/** Period starts that must be billed when reconciliation runs through `through`. */
export function dueRoomPeriodStarts(nextAt: Date, through: Date): Date[] {
  const starts: Date[] = [];
  let cursor = nextAt.getTime();
  const end = through.getTime();
  while (cursor <= end) {
    starts.push(new Date(cursor));
    cursor += ROOM_PERIOD_MS;
  }
  return starts;
}
