/** The clinic charges calendar days in Uzbekistan, including admission/discharge days. */
export const ROOM_BILLING_TIME_ZONE = 'Asia/Tashkent';

export function roomBillingDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ROOM_BILLING_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function nextRoomBillingDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function roomBillingDayCount(admittedAt: Date, through: Date): number {
  return Math.max(1, Math.round((Date.parse(roomBillingDate(through)) - Date.parse(roomBillingDate(admittedAt))) / 86_400_000) + 1);
}
