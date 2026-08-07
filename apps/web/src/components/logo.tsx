import { cn } from '@/lib/utils';

/**
 * AviShifo brand mark — the heart-with-a-chip from the corporate logo, drawn as
 * inline SVG rather than a bitmap so it stays crisp at every size, needs no
 * network request, and can be recoloured by the theme.
 *
 * Colours follow the CRM palette (--primary, hsl(199 89% 40%)) instead of the
 * original file's blue→purple gradient, so the mark sits inside the product
 * rather than next to it.
 */
/** The heart silhouette, shared by both mark variants. */
const HEART_PATH =
  'M24 43.2c-1.1 0-2.16-.4-2.98-1.16C13.9 35.2 3 27.4 3 17.9 3 10.5 8.6 5 15.7 5c3.3 0 6.35 1.36 8.3 3.63C25.95 6.36 29 5 32.3 5 39.4 5 45 10.5 45 17.9c0 9.5-10.9 17.3-18.02 24.14-.82.76-1.88 1.16-2.98 1.16Z';

export interface LogoMarkProps {
  className?: string;
  /**
   * Drop the chip pins and the inner heart. Below roughly 32px those details
   * collapse into noise, so small placements (sidebar, favicon, chips) read
   * better with just the silhouette and one bold chip square.
   */
  simple?: boolean;
}

export function LogoMark({ className, simple = false }: LogoMarkProps) {
  const gradientId = simple ? 'avishifo-mark-simple' : 'avishifo-mark';
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn('h-9 w-9', className)}
      role="img"
      aria-label="AviShifo"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14A5E4" />
          <stop offset="0.55" stopColor="#0B87C1" />
          <stop offset="1" stopColor="#0A5C8C" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d={HEART_PATH} />
      {simple ? (
        <rect x="16" y="14" width="16" height="16" rx="3.6" fill="none" stroke="#fff" strokeWidth="3" />
      ) : (
        <>
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
        </>
      )}
    </svg>
  );
}

export interface LogoProps {
  className?: string;
  /** Hide the wordmark — for collapsed sidebars and tight headers. */
  markOnly?: boolean;
  /** Wordmark size. */
  size?: 'sm' | 'md' | 'lg';
}

const WORDMARK_SIZE = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
} as const;

const MARK_SIZE = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
} as const;

/** Brand mark + wordmark, the standard lockup used across the product. */
export function Logo({ className, markOnly = false, size = 'md' }: LogoProps) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      {/* 28px is below the detail threshold — use the simplified mark there. */}
      <LogoMark className={MARK_SIZE[size]} simple={size === 'sm'} />
      {markOnly ? null : (
        <span className={cn('font-bold tracking-tight text-foreground', WORDMARK_SIZE[size])}>
          AviShifo
        </span>
      )}
    </span>
  );
}
