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
