/**
 * AviShifo brand mark — the corporate heart-with-a-chip, inline SVG so it stays
 * crisp on any screen and needs no asset request. Recoloured from the original
 * blue→purple gradient to the product's brand blue.
 *
 * Kept in sync with apps/web/src/components/logo.tsx and apps/display.
 */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="AviShifo">
      <defs>
        <linearGradient id="portal-mark" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14A5E4" />
          <stop offset="0.55" stopColor="#0B87C1" />
          <stop offset="1" stopColor="#0A5C8C" />
        </linearGradient>
      </defs>
      <path
        fill="url(#portal-mark)"
        d="M24 43.2c-1.1 0-2.16-.4-2.98-1.16C13.9 35.2 3 27.4 3 17.9 3 10.5 8.6 5 15.7 5c3.3 0 6.35 1.36 8.3 3.63C25.95 6.36 29 5 32.3 5 39.4 5 45 10.5 45 17.9c0 9.5-10.9 17.3-18.02 24.14-.82.76-1.88 1.16-2.98 1.16Z"
      />
      <g stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <rect x="16.6" y="14.6" width="14.8" height="14.8" rx="3.2" />
        <path d="M16.6 19.1h-3.3M16.6 22h-3.3M16.6 24.9h-3.3" />
        <path d="M31.4 19.1h3.3M31.4 22h3.3M31.4 24.9h3.3" />
        <path d="M21.1 14.6v-3.3M26.9 14.6v-3.3" />
        <path d="M21.1 29.4v3.3M24 29.4v3.3M26.9 29.4v3.3" />
      </g>
      <path
        fill="#fff"
        d="M24 26.9c-.3 0-.58-.11-.8-.31-1.92-1.79-3.5-3-3.5-4.62a2.46 2.46 0 0 1 2.5-2.44c.72 0 1.4.3 1.8.79.4-.49 1.08-.79 1.8-.79a2.46 2.46 0 0 1 2.5 2.44c0 1.62-1.58 2.83-3.5 4.62-.22.2-.5.31-.8.31Z"
      />
    </svg>
  );
}
