import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AviShifo — Navbat monitori',
  description: 'AviShifo klinikasi jonli navbat monitori (TV displey)',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#070b18',
};

/**
 * Sets the day class before first paint. Without it a screen configured for
 * day mode boots dark-navy and flips to white a moment later — on a wall-
 * mounted TV that flash is the most visible thing in the room. Inlined and
 * dependency-free because the board must survive with no network beyond its
 * own origin.
 */
const THEME_BOOT = `(function(){try{
var m=localStorage.getItem('avishifo_display_theme')||'auto';
var h=new Date().getHours();
var day=m==='day'||(m==='auto'&&h>=7&&h<19);
if(day)document.documentElement.classList.add('theme-day');
}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
