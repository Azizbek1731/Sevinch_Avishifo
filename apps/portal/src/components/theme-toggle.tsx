'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

const LABEL: Record<string, string> = {
  light: 'Kunduzgi ko‘rinish',
  dark: 'Tungi ko‘rinish',
};

/**
 * A single button that flips between light and dark. Patients are on phones
 * whose own dark setting we already follow by default, so a three-way
 * light/dark/system picker would be more choice than the moment deserves —
 * one tap either confirms the phone's choice or overrides it.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Before mount the resolved theme is unknown; render the frame so the header
  // does not jump, but no icon that could contradict what paints a tick later.
  const dark = mounted && resolvedTheme === 'dark';
  const next = dark ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={LABEL[next]}
      title={LABEL[next]}
      className="flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-slate-600 transition hover:bg-slate-100"
    >
      {!mounted ? (
        <span className="h-5 w-5" />
      ) : dark ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  );
}
