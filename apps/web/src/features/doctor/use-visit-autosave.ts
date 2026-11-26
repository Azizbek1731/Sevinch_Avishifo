'use client';

import { useEffect, useRef } from 'react';

type DraftEnvelope<T> = {
  baselineKey: string;
  savedAt: number;
  data: T;
};

function storageKey(visitId: string, scope: string): string {
  return `avishifo:visit-draft:${visitId}:${scope}`;
}

function readDraft<T>(visitId: string, scope: string): DraftEnvelope<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(visitId, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T>;
    if (!parsed || typeof parsed !== 'object' || parsed.data == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft<T>(visitId: string, scope: string, data: T, baselineKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: DraftEnvelope<T> = { baselineKey, savedAt: Date.now(), data };
    window.localStorage.setItem(storageKey(visitId, scope), JSON.stringify(envelope));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function clearVisitDraft(visitId: string, scope: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(visitId, scope));
  } catch {
    // ignore
  }
}

type AutosaveOptions<T> = {
  visitId: string;
  scope: string;
  /** Fingerprint of the last server-known values (e.g. JSON of visit fields). */
  baselineKey: string;
  /** Current form snapshot. */
  getSnapshot: () => T;
  /** Cheap dependency that changes when the user types. */
  watchKey: string;
  isDirty: boolean;
  enabled: boolean;
  /** Restore local draft into the form (once). */
  onRestore: (data: T) => void;
  /** Optional silent server persist (open visits only). */
  onPersistServer?: (data: T) => void;
  debounceMs?: number;
};

/**
 * Keeps clinical typing across tab switches / navigation via localStorage,
 * and optionally debounces a silent server save. Explicit Save still works.
 */
export function useVisitAutosave<T>({
  visitId,
  scope,
  baselineKey,
  getSnapshot,
  watchKey,
  isDirty,
  enabled,
  onRestore,
  onPersistServer,
  debounceMs = 1000,
}: AutosaveOptions<T>): { clearDraft: () => void } {
  const restoredRef = useRef(false);
  const getSnapshotRef = useRef(getSnapshot);
  const persistRef = useRef(onPersistServer);
  const restoreRef = useRef(onRestore);
  getSnapshotRef.current = getSnapshot;
  persistRef.current = onPersistServer;
  restoreRef.current = onRestore;

  useEffect(() => {
    restoredRef.current = false;
  }, [visitId, scope]);

  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    const draft = readDraft<T>(visitId, scope);
    if (!draft) return;
    // Only restore drafts started from the same server baseline (avoid clobbering newer server data).
    if (draft.baselineKey !== baselineKey) {
      clearVisitDraft(visitId, scope);
      return;
    }
    try {
      if (JSON.stringify(draft.data) === JSON.stringify(getSnapshotRef.current())) return;
    } catch {
      // restore anyway
    }
    restoreRef.current(draft.data);
  }, [visitId, scope, baselineKey, enabled]);

  useEffect(() => {
    if (!enabled || !isDirty) return;
    const timer = window.setTimeout(() => {
      const data = getSnapshotRef.current();
      writeDraft(visitId, scope, data, baselineKey);
      persistRef.current?.(data);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [visitId, scope, baselineKey, watchKey, isDirty, enabled, debounceMs]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (!isDirty) return;
      writeDraft(visitId, scope, getSnapshotRef.current(), baselineKey);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [visitId, scope, baselineKey, isDirty, enabled]);

  return {
    clearDraft: () => clearVisitDraft(visitId, scope),
  };
}
