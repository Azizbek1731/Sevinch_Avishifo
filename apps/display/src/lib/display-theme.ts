/**
 * Day / night appearance for the waiting-room screen.
 *
 * A TV hangs on one wall for years: bright daylight washes out the dark board,
 * and after closing time a full-brightness dark-navy panel is the only light
 * left in the room. `auto` is the default because nobody walks over to a
 * ceiling-mounted screen twice a day to flip it.
 */

export const DISPLAY_THEME_KEY = 'avishifo_display_theme';

export type DisplayThemeMode = 'auto' | 'day' | 'night';
export type ResolvedDisplayTheme = 'day' | 'night';

/** Local clock hours, inclusive start, exclusive end. */
export const DAY_STARTS_AT = 7;
export const DAY_ENDS_AT = 19;

export function isDaytime(at: Date): boolean {
  const h = at.getHours();
  return h >= DAY_STARTS_AT && h < DAY_ENDS_AT;
}

export function resolveDisplayTheme(mode: DisplayThemeMode, at: Date): ResolvedDisplayTheme {
  if (mode === 'day') return 'day';
  if (mode === 'night') return 'night';
  return isDaytime(at) ? 'day' : 'night';
}

export function readDisplayThemeMode(): DisplayThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(DISPLAY_THEME_KEY);
    return raw === 'day' || raw === 'night' || raw === 'auto' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveDisplayThemeMode(mode: DisplayThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISPLAY_THEME_KEY, mode);
  } catch {
    // Smart-TV browsers sometimes refuse storage; the choice then lasts the session.
  }
}

/**
 * The class lives on <html>, so the CSS variables cascade to the body
 * background too — the board's glows are painted there, not on a React node.
 */
export function applyDisplayTheme(theme: ResolvedDisplayTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('theme-day', theme === 'day');
}
