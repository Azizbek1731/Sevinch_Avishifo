import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0e7ab8',
          dark: '#0a5c8c',
          light: '#e6f4fb',
        },
      },
    },
  },
  plugins: [],
};

export default config;
