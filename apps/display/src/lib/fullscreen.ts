/** Fullscreen helpers with vendor + smart-TV fallbacks. */

interface FullscreenDoc extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FullscreenEl extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDoc;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  const doc = document as FullscreenDoc;
  const el = document.documentElement as FullscreenEl;
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    }
  } catch {
    // Some TV browsers reject programmatic fullscreen — ignore silently.
  }
}
