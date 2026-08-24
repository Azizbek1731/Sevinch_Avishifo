import type { Config } from 'tailwindcss';

/**
 * The portal was written directly against Tailwind's slate ramp (≈300 usages),
 * so rather than bolt a `dark:` variant onto every one of them, the ramp itself
 * is served from CSS variables and mirrored under `.dark` in globals.css. Every
 * existing class then flips on its own.
 *
 * `white` is deliberately NOT remapped: it is the text colour on brand and
 * danger buttons, where it must stay white in both themes. Card surfaces use
 * the separate `surface` token instead.
 */
const slate = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
    step,
    `rgb(var(--s-${step}) / <alpha-value>)`,
  ]),
);

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate,
        surface: 'rgb(var(--surface) / <alpha-value>)',
        brand: {
          DEFAULT: '#0e7ab8',
          dark: '#0a5c8c',
          light: 'rgb(var(--brand-light) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
