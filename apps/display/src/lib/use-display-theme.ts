'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyDisplayTheme,
  readDisplayThemeMode,
  resolveDisplayTheme,
  saveDisplayThemeMode,
  type DisplayThemeMode,
  type ResolvedDisplayTheme,
} from '@/lib/display-theme';

/**
 * Keeps the board's appearance in step with the mode and, in `auto`, with the
 * clock. The screen is never reloaded — it runs for months — so the crossing
 * from day to night has to be noticed by a ticking check rather than at boot.
 */
export function useDisplayTheme(): {
  mode: DisplayThemeMode;
  resolved: ResolvedDisplayTheme;
  setMode: (mode: DisplayThemeMode) => void;
} {
  const [mode, setModeState] = useState<DisplayThemeMode>('auto');
  const [resolved, setResolved] = useState<ResolvedDisplayTheme>('night');

  useEffect(() => {
    setModeState(readDisplayThemeMode());
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = resolveDisplayTheme(mode, new Date());
      setResolved(next);
      applyDisplayTheme(next);
    };
    sync();
    if (mode !== 'auto') return;
    // A minute is far finer than the hour boundary it is watching for, and
    // costs nothing next to the board's own socket traffic.
    const id = window.setInterval(sync, 60_000);
    return () => window.clearInterval(id);
  }, [mode]);

  const setMode = useCallback((next: DisplayThemeMode) => {
    setModeState(next);
    saveDisplayThemeMode(next);
  }, []);

  return { mode, resolved, setMode };
}
