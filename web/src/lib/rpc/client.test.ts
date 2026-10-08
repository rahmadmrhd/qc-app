import { expect, test, vi } from 'vitest';
import { createRpcClient } from './client';
import { RpcError } from './rpc-error';

function transportReturning(raw: string) {
  return { call: vi.fn(async (_method: string, _payload: string, _token: string) => raw) };
}

test('mengirim method, payload JSON, dan token lalu mengembalikan data', async () => {
  const transport = transportReturning(JSON.stringify({ ok: true, data: [{ id: '1' }] }));
  const rpc = createRpcClient(transport, () => 'tok');
  await expect(rpc('access.users.list', null)).resolves.toEqual([{ id: '1' }]);
  expect(transport.call).toHaveBeenCalledWith('access.users.list', 'null', 'tok');
});

test('tanpa token mengirim string kosong', async () => {
  const transport = transportReturning(JSON.stringify({ ok: true, data: null }));
  await createRpcClient(transport, () => null)('auth.me', null);
  expect(transport.call).toHaveBeenCalledWith('auth.me', 'null', '');
});

test('error dari server menjadi RpcError dengan code, requestId, dan fields', async () => {
  const body = {
    ok: false,
    error: {
      code: 'VALIDATION',
      message: 'Input tidak valid',
      requestId: 'abcd1234',
      fields: { email: 'Wajib diisi' },
    },
  };
  const rpc = createRpcClient(transportReturning(JSON.stringify(body)), () => 't');
  const error = await rpc('auth.me', null).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RpcError);
  expect(error).toMatchObject({
    code: 'VALIDATION',
    requestId: 'abcd1234',
    fields: { email: 'Wajib diisi' },
  });
});

test('kegagalan transport dan respons rusak menjadi RpcError INTERNAL', async () => {
  const failing = { call: vi.fn(async () => Promise.reject(new Error('offline'))) };
  await expect(createRpcClient(failing, () => 't')('auth.me', null)).rejects.toMatchObject({
    code: 'INTERNAL',
  });
  await expect(
    createRpcClient(transportReturning('<html>'), () => 't')('auth.me', null),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  await expect(
    createRpcClient(transportReturning('{}'), () => 't')('auth.me', null),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
});
