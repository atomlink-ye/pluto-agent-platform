import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
  resolve: {
    alias: [
      {
        find: /^@pluto\/v2-core\/(.+)$/,
        replacement: `${new URL('../pluto-v2-core/src/', import.meta.url).pathname}$1.ts`,
      },
      {
        find: '@pluto/v2-core',
        replacement: new URL('../pluto-v2-core/src/index.ts', import.meta.url).pathname,
      },
    ],
  },
});
