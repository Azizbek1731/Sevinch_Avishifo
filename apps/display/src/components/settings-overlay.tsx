'use client';

import { useEffect, useState } from 'react';
import type { ConnectionState } from '@/lib/use-display-socket';
import { isFullscreen, toggleFullscreen } from '@/lib/fullscreen';
import {
  DAY_ENDS_AT,
  DAY_STARTS_AT,
  type DisplayThemeMode,
  type ResolvedDisplayTheme,
} from '@/lib/display-theme';

interface SettingsOverlayProps {
  open: boolean;
  connection: ConnectionState;
  /** Masked hint of the active token, e.g. "…a1b2c3". */
  tokenHint: string | null;
  themeMode: DisplayThemeMode;
  /** What `themeMode` currently amounts to — `auto` needs the clock to say. */
  resolvedTheme: ResolvedDisplayTheme;
  onThemeModeChange: (mode: DisplayThemeMode) => void;
  onClose: () => void;
  /** Clears the saved token and returns to the setup screen. */
  onChangeToken: () => void;
}

const THEME_OPTIONS: Array<{ mode: DisplayThemeMode; icon: string; label: string }> = [
  { mode: 'day', icon: '☀️', label: 'Kunduzgi' },
  { mode: 'night', icon: '🌙', label: 'Tungi' },
  { mode: 'auto', icon: '🕒', label: 'Avto' },
];

function connectionLabel(state: ConnectionState): { text: string; tone: string; dot: string } {
  if (state === 'connected') return { text: 'Jonli — ulangan', tone: 'text-ok', dot: 'bg-emerald-400' };
  if (state === 'connecting') return { text: 'Ulanmoqda…', tone: 'text-warn', dot: 'bg-amber-400' };
  return { text: 'Aloqa uzildi', tone: 'text-bad', dot: 'bg-red-500' };
}

const BTN =
  'flex w-full items-center gap-4 rounded-2xl border border-edge/10 bg-raise/5 px-6 py-5 text-2xl font-semibold text-ink transition-colors hover:bg-raise/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export function SettingsOverlay({
  open,
  connection,
  tokenHint,
  themeMode,
  resolvedTheme,
  onThemeModeChange,
  onClose,
  onChangeToken,
}: SettingsOverlayProps) {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    if (open) setFs(isFullscreen());
  }, [open]);

  if (!open) return null;
  const conn = connectionLabel(connection);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/80 p-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="animate-enter w-full max-w-xl rounded-[2rem] border border-edge/10 bg-panel/95 p-10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-3">
          <span aria-hidden="true" className="text-3xl">
            ⚙️
          </span>
          <h2 className="text-4xl font-black tracking-tight">Displey sozlamalari</h2>
        </div>

        <div className="mb-8 flex items-center gap-3 text-xl">
          <span className={`h-3.5 w-3.5 rounded-full ${conn.dot}`} />
          <span className={`font-semibold ${conn.tone}`}>{conn.text}</span>
          {tokenHint ? (
            <span className="ml-auto font-mono text-lg text-ink-faint">token: {tokenHint}</span>
          ) : null}
        </div>

        <div className="mb-8">
          <p className="mb-3 text-xl font-semibold text-ink-dim">Ekran ko&apos;rinishi</p>
          <div
            className="grid grid-cols-3 gap-3"
            role="radiogroup"
            aria-label="Ekran ko'rinishi"
          >
            {THEME_OPTIONS.map((opt) => {
              const active = themeMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onThemeModeChange(opt.mode)}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-4 text-xl font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    active
                      ? 'border-brand bg-brand/15 text-ink'
                      : 'border-edge/10 bg-raise/5 text-ink-dim hover:bg-raise/10'
                  }`}
                >
                  <span aria-hidden="true" className="text-3xl">
                    {opt.icon}
                  </span>
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-base text-ink-faint">
            {themeMode === 'auto'
              ? `Soatga qarab o'zi almashadi: ${DAY_STARTS_AT}:00–${DAY_ENDS_AT}:00 kunduzgi, qolgan vaqt tungi. Hozir — ${
                  resolvedTheme === 'day' ? 'kunduzgi' : 'tungi'
                }.`
              : "Doim shu ko'rinishda qoladi."}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <button
            type="button"
            className={BTN}
            autoFocus
            onClick={() => void toggleFullscreen().then(() => setFs(isFullscreen()))}
          >
            <span className="text-3xl">⛶</span>
            {fs ? "To'liq ekrandan chiqish" : "To'liq ekran"}
          </button>

          <button type="button" className={BTN} onClick={() => window.location.reload()}>
            <span className="text-3xl">↻</span>
            Ekranni yangilash
          </button>

          <button
            type="button"
            className="flex w-full items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-5 text-2xl font-semibold text-bad transition-colors hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            onClick={onChangeToken}
          >
            <span className="text-3xl">⎋</span>
            Tokenni almashtirish / chiqish
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-8 w-full rounded-2xl bg-brand py-4 text-2xl font-bold text-slate-950 transition-colors hover:bg-brand-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Yopish
        </button>

        <p className="mt-6 text-center text-base text-ink-faint">
          Tokenni klinika panelidan oling: Sozlamalar → Filiallar → «TV displey tokeni»
        </p>
      </div>
    </div>
  );
}
