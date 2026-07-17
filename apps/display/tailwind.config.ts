import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontSize: {
        // TV display: readable from 5+ meters
        display: ['9rem', { lineHeight: '1' }],
        'display-sm': ['5rem', { lineHeight: '1.05' }],
      },
    },
  },
  plugins: [],
};

export default config;
