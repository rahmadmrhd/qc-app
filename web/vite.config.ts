import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fromHere('../shared'),
      '@gas-test': fromHere('../gas/test-support'),
      '@gas': fromHere('../gas/src'),
      '@': fromHere('./src'),
    },
  },
  server: { port: 3000, fs: { allow: ['..'] } },
  build: {
    // Aset statis Worker (assets.directory di worker/wrangler.jsonc). Berpotongan: dilayani Cloudflare tanpa Worker.
    outDir: '../worker/dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1_000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Tes interaksi (userEvent + jsdom) bisa melewati 5 dtk saat seluruh suite berjalan paralel.
    testTimeout: 15_000,
  },
});
