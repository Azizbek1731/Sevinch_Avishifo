'use client';

import { useCallback, useSyncExternalStore } from 'react';

const PREFIX = 'avishifo:pdf-printed:';
const EVENT = 'avishifo:pdf-printed';

export type PdfPrintedScope = 'lab' | 'visit';

function storageKey(scope: PdfPrintedScope, id: string): string {
  return `${PREFIX}${scope}:${id}`;
}

export function isPdfPrinted(scope: PdfPrintedScope, id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(storageKey(scope, id)) != null;
  } catch {
    return false;
  }
}

/** Mark a lab/UZI report PDF as taken/printed so the action button turns green. */
export function markPdfPrinted(scope: PdfPrintedScope, id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    window.localStorage.setItem(storageKey(scope, id), new Date().toISOString());
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { scope, id } }));
  } catch {
    // private mode / quota
  }
}

/** Shared styles: green filled button once the PDF was downloaded or printed. */
export function pdfPrintedButtonClass(printed: boolean): string | undefined {
  if (!printed) return undefined;
  return 'border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 hover:text-white';
}

export function usePdfPrinted(scope: PdfPrintedScope, id: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const onLocal = (event: Event) => {
        const detail = (event as CustomEvent<{ scope: string; id: string }>).detail;
        if (detail?.scope === scope && detail?.id === id) onStoreChange();
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey(scope, id)) onStoreChange();
      };
      window.addEventListener(EVENT, onLocal);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(EVENT, onLocal);
        window.removeEventListener('storage', onStorage);
      };
    },
    [scope, id],
  );

  const printed = useSyncExternalStore(
    subscribe,
    () => isPdfPrinted(scope, id),
    () => false,
  );

  return {
    printed,
    markPrinted: () => markPdfPrinted(scope, id),
    className: pdfPrintedButtonClass(printed),
  };
}
