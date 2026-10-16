import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createGasTransport } from './gas-transport';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const ok = (data: unknown) => ({ ok: true, data });

test('satu panggilan dikirim langsung tanpa bungkus batch', async () => {
  const run = vi.fn(async () => JSON.stringify(ok(1)));
  const transport = createGasTransport(run);
  const pending = transport.call('auth.me', 'null', 'tok');
  await vi.advanceTimersByTimeAsync(20);
  await expect(pending).resolves.toBe(JSON.stringify(ok(1)));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith('auth.me', 'null', 'tok');
});

test('panggilan dalam satu jendela digabung menjadi SATU eksekusi batch; hasil dipetakan per item berurutan', async () => {
  const run = vi.fn(async (_method: string, payload: string) => {
    const items = JSON.parse(payload) as Array<{ m: string }>;
    return JSON.stringify({ batch: items.map((item) => ok(item.m)) });
  });
  const transport = createGasTransport(run);
  const a = transport.call('access.roles.list', 'null', 'tok');
  const b = transport.call('access.locations.list', '{"x":1}', 'tok');
  const c = transport.call('access.audit.list', '{"page":2}', 'tok');
  await vi.advanceTimersByTimeAsync(20);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    'batch',
    JSON.stringify([
      { m: 'access.roles.list', p: 'null' },
      { m: 'access.locations.list', p: '{"x":1}' },
      { m: 'access.audit.list', p: '{"page":2}' },
    ]),
    'tok',
  );
  await expect(a).resolves.toBe(JSON.stringify(ok('access.roles.list')));
  await expect(b).resolves.toBe(JSON.stringify(ok('access.locations.list')));
  await expect(c).resolves.toBe(JSON.stringify(ok('access.audit.list')));
});

test('hasil batch tidak sesuai (galat validasi server atau bukan JSON): semua item menerima respons mentah', async () => {
  const raw = JSON.stringify({
    ok: false,
    error: { code: 'VALIDATION', message: 'x', requestId: 'r' },
  });
  const transport = createGasTransport(vi.fn(async () => raw));
  const a = transport.call('a', 'null', 't');
  const b = transport.call('b', 'null', 't');
  await vi.advanceTimersByTimeAsync(20);
  await expect(a).resolves.toBe(raw);
  await expect(b).resolves.toBe(raw);
});

test('kegagalan jaringan menolak semua item dalam batch', async () => {
  const transport = createGasTransport(vi.fn(async () => Promise.reject(new Error('putus'))));
  const a = transport.call('a', 'null', 't');
  const b = transport.call('b', 'null', 't');
  const settled = Promise.allSettled([a, b]);
  await vi.advanceTimersByTimeAsync(20);
  expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected']);
});

test('token berbeda tidak berbagi eksekusi; batas item per batch dihormati', async () => {
  const run = vi.fn(async (_m: string, payload: string, _t: string) => {
    const parsed = JSON.parse(payload) as unknown;
    return JSON.stringify(Array.isArray(parsed) ? { batch: parsed.map(() => ok(0)) } : ok(0));
  });
  const transport = createGasTransport(run, { maxItems: 2 });
  const calls = [
    transport.call('a', 'null', 't1'),
    transport.call('b', 'null', 't2'),
    transport.call('c', 'null', 't1'),
    transport.call('d', 'null', 't1'),
  ];
  await vi.advanceTimersByTimeAsync(20);
  await Promise.all(calls);
  // t1: [a,c] batch + [d] tunggal; t2: [b] tunggal
  expect(run.mock.calls.map(([method, , token]) => `${token}:${method}`).sort()).toEqual([
    't1:batch',
    't1:d',
    't2:b',
  ]);
});

test('payload besar (unggahan) dikirim sendiri dan tidak menunda atau digabung', async () => {
  const run = vi.fn(async () => JSON.stringify(ok(1)));
  const transport = createGasTransport(run, { maxItemChars: 10 });
  const big = transport.call('files.upload', 'x'.repeat(50), 't');
  expect(run).toHaveBeenCalledTimes(1); // langsung, tanpa menunggu jendela
  await big;
});
