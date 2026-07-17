import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AviShifo — Navbat monitori',
  description: 'AviShifo klinikasi jonli navbat monitori (TV displey)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body className="min-h-screen bg-slate-950 font-sans text-white antialiased">{children}</body>
    </html>
  );
}
