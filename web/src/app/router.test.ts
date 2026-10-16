import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { createAppRouter } from './router';

test('tanpa prefetch saat hover: tiap RPC google.script.run antre di klien dan memperlambat klik nyata', () => {
  const router = createAppRouter(new QueryClient());
  expect(router.options.defaultPreload).toBe(false);
});

test('navigasi langsung berpindah dan menampilkan "memuat data" (bukan menahan halaman lama sampai data tiba)', () => {
  const router = createAppRouter(new QueryClient());
  expect(router.options.defaultPendingComponent).toBeDefined();
  expect(router.options.defaultPendingMs).toBeLessThanOrEqual(150);
  expect(router.options.defaultPendingMinMs).toBeGreaterThan(0);
});
