'use client';

import { useEffect, useState } from 'react';
import { readTickerText } from '@/lib/storage';

const TICKER_RELOAD_MS = 30_000;

/**
 * Scrolling news strip. Text comes from localStorage('avishifo_display_ticker')
 * and is re-read periodically so staff can update it without a reload.
 */
export function NewsTicker() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const load = (): void => setText(readTickerText());
    load();
    const id = window.setInterval(load, TICKER_RELOAD_MS);
    return () => window.clearInterval(id);
  }, []);

  if (text === null) return null;

  // Rendered twice: the marquee shifts by -50% of its own width, so the second
  // copy slides in exactly where the first started — a seamless loop.
  const content = `${text}  •  `.repeat(3);

  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <div className="animate-ticker inline-flex whitespace-nowrap will-change-transform">
        <span className="text-3xl text-ink-dim">{content}</span>
        <span className="text-3xl text-ink-dim">{content}</span>
      </div>
    </div>
  );
}
