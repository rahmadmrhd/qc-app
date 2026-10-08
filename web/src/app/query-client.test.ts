import { expect, test, vi } from 'vitest';
import { RpcError } from '@/lib/rpc/rpc-error';
import { handleGlobalError, shouldRetry } from './query-client';

test('hanya error INTERNAL yang di-retry, maksimal sekali', () => {
  expect(shouldRetry(0, new RpcError('INTERNAL', 'x', '-'))).toBe(true);
  expect(shouldRetry(1, new RpcError('INTERNAL', 'x', '-'))).toBe(false);
  expect(shouldRetry(0, new RpcError('FORBIDDEN', 'x', 'r'))).toBe(false);
  expect(shouldRetry(0, new Error('x'))).toBe(false);
});

test('UNAUTHENTICATED memicu logout global, FORBIDDEN menampilkan notifikasi', () => {
  const deps = { onUnauthenticated: vi.fn(), notify: vi.fn() };
  handleGlobalError(new RpcError('UNAUTHENTICATED', 'x', 'r'), deps);
  expect(deps.onUnauthenticated).toHaveBeenCalledOnce();
  handleGlobalError(new RpcError('FORBIDDEN', 'x', 'r'), deps);
  expect(deps.notify).toHaveBeenCalledWith('Anda tidak memiliki akses untuk aksi ini.');
  handleGlobalError(new RpcError('VALIDATION', 'x', 'r'), deps);
  handleGlobalError(new Error('lain'), deps);
  expect(deps.onUnauthenticated).toHaveBeenCalledOnce();
  expect(deps.notify).toHaveBeenCalledOnce();
});
