import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        // TV display: readable from 5+ meters.
        hero: ['13rem', { lineHeight: '0.9', letterSpacing: '-0.03em' }],
        display: ['9rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'display-sm': ['5.5rem', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
      },
      colors: {
        // Day/night tokens — values live in globals.css, flipped by `.theme-day`.
        screen: 'rgb(var(--screen) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        scrim: 'rgb(var(--scrim) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        raise: 'rgb(var(--raise) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          dim: 'rgb(var(--ink-dim) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        // Brand teal is bright enough to carry dark text on either background,
        // so it stays fixed in both themes.
        brand: {
          DEFAULT: '#2dd4bf',
          bright: '#5eead4',
          deep: '#0d9488',
        },
      },
    },
  },
  plugins: [],
};

export default config;
