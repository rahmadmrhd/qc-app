import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { createAppRouter } from './router';

test('tanpa prefetch saat hover: data dimuat saat navigasi saja', () => {
  const router = createAppRouter(new QueryClient());
  expect(router.options.defaultPreload).toBe(false);
});

test('navigasi langsung berpindah dan menampilkan "memuat data" (bukan menahan halaman lama sampai data tiba)', () => {
  const router = createAppRouter(new QueryClient());
  expect(router.options.defaultPendingComponent).toBeDefined();
  expect(router.options.defaultPendingMs).toBeLessThanOrEqual(150);
  expect(router.options.defaultPendingMinMs).toBeGreaterThan(0);
});

test('memakai browser history: URL berupa path biasa, bukan hash', async () => {
  window.history.replaceState(null, '', '/login');
  const router = createAppRouter(new QueryClient());
  await router.navigate({ to: '/login' });
  expect(window.location.pathname).toBe('/login');
  expect(window.location.hash).toBe('');
});
