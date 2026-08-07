/** AviShifo brand lockup: the corporate heart-with-a-chip mark + wordmark.
 * Inline SVG, no assets — a TV screen must render it without a network round trip. */
export function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/15 ring-1 ring-brand/40">
        <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden="true">
          <defs>
            <linearGradient id="tv-mark" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#14A5E4" />
              <stop offset="0.55" stopColor="#0B87C1" />
              <stop offset="1" stopColor="#0A5C8C" />
            </linearGradient>
          </defs>
          <path
            fill="url(#tv-mark)"
            d="M24 43.2c-1.1 0-2.16-.4-2.98-1.16C13.9 35.2 3 27.4 3 17.9 3 10.5 8.6 5 15.7 5c3.3 0 6.35 1.36 8.3 3.63C25.95 6.36 29 5 32.3 5 39.4 5 45 10.5 45 17.9c0 9.5-10.9 17.3-18.02 24.14-.82.76-1.88 1.16-2.98 1.16Z"
          />
          <rect x="16" y="14" width="16" height="16" rx="3.6" fill="none" stroke="#fff" strokeWidth="2.8" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="text-4xl font-black tracking-tight">
          Avi<span className="text-brand-bright">Shifo</span>
        </div>
        {subtitle ? (
          <div className="mt-1 text-lg font-medium uppercase tracking-[0.25em] text-slate-500">
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
