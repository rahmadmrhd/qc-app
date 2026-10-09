import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: false }),
    react(),
    tailwindcss(),
    viteSingleFile(),
  ],
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
    outDir: '../gas/dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5_000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Tes interaksi (userEvent + jsdom) bisa melewati 5 dtk saat seluruh suite berjalan paralel.
    testTimeout: 15_000,
  },
});
