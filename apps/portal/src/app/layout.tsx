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
  themeColor: '#0e7ab8',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
