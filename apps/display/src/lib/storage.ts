/** localStorage helpers — every access is guarded for smart-TV browsers. */

export const DISPLAY_TOKEN_KEY = 'avishifo_display_token';
export const DISPLAY_TICKER_KEY = 'avishifo_display_ticker';

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readDisplayToken(): string | null {
  const value = safeGet(DISPLAY_TOKEN_KEY);
  return value !== null && value.trim().length > 0 ? value.trim() : null;
}

export function saveDisplayToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISPLAY_TOKEN_KEY, token);
  } catch {
    // Storage unavailable — the board will still work until reload.
  }
}

export function clearDisplayToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DISPLAY_TOKEN_KEY);
  } catch {
    // Ignore: nothing sensible to do on a TV screen.
  }
}

/** Optional scrolling news text, set by clinic staff via localStorage. */
export function readTickerText(): string | null {
  const value = safeGet(DISPLAY_TICKER_KEY);
  return value !== null && value.trim().length > 0 ? value.trim() : null;
}
