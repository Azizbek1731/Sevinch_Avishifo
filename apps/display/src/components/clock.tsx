'use client';

import { useEffect, useState } from 'react';

function formatTashkentTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tashkent',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    // Very old TV browsers without full timezone data: fall back to device time.
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}

/** Live HH:mm:ss clock in Asia/Tashkent. */
export function Clock() {
  const [time, setTime] = useState('--:--:--');

  useEffect(() => {
    const tick = (): void => setTime(formatTashkentTime(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return <div className="font-mono text-4xl font-semibold tabular-nums text-slate-100">{time}</div>;
}
