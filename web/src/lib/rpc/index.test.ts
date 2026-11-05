import { expect, test, vi } from 'vitest';
import { createRpc } from './index';

test('id migrated diarahkan ke REST, sisanya ke transport lama', async () => {
  const legacy = vi.fn(async () => 'lama');
  const rest = vi.fn(async () => 'rest');
  const rpc = createRpc(legacy as never, rest as never, new Set(['brands.list']));
  await expect(rpc('brands.list', null)).resolves.toBe('rest');
  await expect(rpc('customers.list', null)).resolves.toBe('lama');
  expect(rest).toHaveBeenCalledWith('brands.list', null);
  expect(legacy).toHaveBeenCalledWith('customers.list', null);
  expect(rest).toHaveBeenCalledTimes(1);
  expect(legacy).toHaveBeenCalledTimes(1);
});
