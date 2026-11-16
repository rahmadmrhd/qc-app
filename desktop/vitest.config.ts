import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tes desktop berjalan di Node (bukan bun test): runtime tes sama dengan runtime yang dikirim.
export default defineConfig({
  resolve: {
    alias: {
      '@countrylock': fileURLToPath(new URL('../countrylock/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'spike/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
