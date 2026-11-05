import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const SERVER_DEV_URL = process.env.SERVER_DEV_URL ?? 'http://localhost:8788';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fromHere('../shared'),
      '@': fromHere('./src'),
    },
  },
  server: {
    port: 3000,
    fs: { allow: ['..'] },
    // Backend lokal: `bun run dev:server` (server Bun, MariaDB dev lewat terowongan) di :8788. Cookie sesi tetap
    // same-origin (:3000).
    proxy: {
      '/api': SERVER_DEV_URL,
      '/auth': SERVER_DEV_URL,
      '/sync': SERVER_DEV_URL,
    },
  },
  build: {
    // Berkas statis yang dilayani server Bun (STATIC_DIR, bawaan server/dist) dengan fallback SPA.
    outDir: '../server/dist',
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
