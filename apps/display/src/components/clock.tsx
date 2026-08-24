'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS_UZ = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const MONTHS_UZ = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

function tashkentParts(date: Date): { time: string; day: string; weekday: string } {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tashkent',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const map = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const time = `${map.get('hour')}:${map.get('minute')}:${map.get('second')}`;
    const d = Number(map.get('day'));
    const m = Number(map.get('month')) - 1;
    // Recompute weekday index in Tashkent from a stable Date to localize in Uzbek.
    const tzDate = new Date(
      `${map.get('year')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`,
    );
    const weekday = WEEKDAYS_UZ[tzDate.getUTCDay()] ?? '';
    const day = `${d}-${MONTHS_UZ[m] ?? ''}`;
    return { time, day, weekday };
  } catch {
    const pad = (v: number): string => String(v).padStart(2, '0');
    return {
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
      day: '',
      weekday: '',
    };
  }
}

/** Live clock + Uzbek date, Asia/Tashkent. */
export function Clock() {
  const [parts, setParts] = useState({ time: '--:--:--', day: '', weekday: '' });

  useEffect(() => {
    const tick = (): void => setParts(tashkentParts(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="text-right leading-none">
      <div className="font-mono text-5xl font-bold tabular-nums text-ink">{parts.time}</div>
      {parts.day ? (
        <div className="mt-1.5 text-lg font-medium text-ink-dim">
          {parts.weekday}, {parts.day}
        </div>
      ) : null}
    </div>
  );
}
