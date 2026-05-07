import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@pluto/v2-core': new URL('../pluto-v2-core/src/index.ts', import.meta.url).pathname,
    },
  },
});
