import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/components/providers';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: {
    default: 'AviShifo — Bemor portali',
    template: '%s — AviShifo',
  },
  description: "Shifokorga onlayn yoziling: qabullar, tahlil natijalari va hisoblar bir joyda.",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Without this env(safe-area-inset-*) is always 0 on iOS, and the bottom tab
  // bar would sit under the home indicator.
  viewportFit: 'cover',
  themeColor: '#0e7ab8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes writes the class onto <html> before paint; without
    // suppressHydrationWarning React logs a mismatch on every load.
    <html lang="uz" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6 md:pb-20">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
