import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    globals: true,
    passWithNoTests: true,
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
        target: 'es2022',
      },
      // Must stay ESM: vitest cannot be require()d from CJS-transformed specs.
      module: { type: 'es6' },
    }),
  ],
});
