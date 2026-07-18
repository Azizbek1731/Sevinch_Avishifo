/** AviShifo brand lockup: pulse glyph + wordmark. Inline SVG, no assets. */
export function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/15 ring-1 ring-brand/40">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-brand-bright" aria-hidden="true">
          <path
            d="M2 12h4l2-6 4 12 2.5-7L18 12h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
