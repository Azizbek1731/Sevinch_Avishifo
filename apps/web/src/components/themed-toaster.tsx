'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

/**
 * Sonner paints its own surface and does not read our CSS variables, so without
 * being told the active theme it keeps showing white toasts over a dark panel.
 */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      position="top-right"
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
    />
  );
}
