import { expect, test, vi } from 'vitest';
import { adaptMockToWorker } from './mock-worker-adapter';
import type { RpcTransport } from './transport';

const env = (data: unknown) => JSON.stringify({ ok: true, data });

function innerReturning(map: Record<string, unknown>): RpcTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    call: vi.fn(async (method: string) => {
      calls.push(method);
      return env(map[method]);
    }),
  };
}

const handover = (id: string, status: string, updatedAt: string) => ({
  id,
  number: `ST-${id}`,
  status,
  updatedAt,
  checklist: [],
});

test('handovers.board: satu status per panggilan, berkursor, dengan total', async () => {
  const inner = innerReturning({
    'handovers.board': [
      handover('1', 'new', '2026-10-01'),
      handover('2', 'new', '2026-10-02'),
      handover('3', 'new', '2026-10-03'),
      handover('4', 'done', '2026-10-04'),
    ],
  });
  const adapted = adaptMockToWorker(inner);
  const first = JSON.parse(
    await adapted.call(
      'handovers.board',
      JSON.stringify({ locationIds: ['a'], status: 'new', limit: 2 }),
      '',
    ),
  );
  expect(first.data.items.map((t: { id: string }) => t.id)).toEqual(['3', '2']);
  expect(first.data).toMatchObject({ total: 3, nextCursor: '2' });
  const second = JSON.parse(
    await adapted.call(
      'handovers.board',
      JSON.stringify({ locationIds: ['a'], status: 'new', limit: 2, cursor: '2' }),
      '',
    ),
  );
  expect(second.data.items.map((t: { id: string }) => t.id)).toEqual(['1']);
  expect(second.data.nextCursor).toBeNull();
});

test('items.list: filter kata kunci dan status, lalu berkursor', async () => {
  const item = (id: string, brand: string, status: string) => ({
    id,
    brand,
    model: 'X',
    aliases: [],
    status,
  });
  const inner = innerReturning({
    'items.list': [
      item('1', 'Mikrotik', 'active'),
      item('2', 'Mikrotik', 'inactive'),
      item('3', 'Ubiquiti', 'active'),
    ],
  });
  const adapted = adaptMockToWorker(inner);
  const result = JSON.parse(
    await adapted.call('items.list', JSON.stringify({ query: 'mikrotik', status: 'active' }), ''),
  );
  expect(result.data.items.map((i: { id: string }) => i.id)).toEqual(['1']);
  expect(result.data.nextCursor).toBeNull();
});

test('access.audit.list: halaman bernomor lama dipetakan ke jendela kursor', async () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` }));
  const inner: RpcTransport = {
    call: vi.fn(async (_m: string, payload: string) => {
      const { page } = JSON.parse(payload) as { page: number };
      const size = 2;
      return env({
        entries: entries.slice((page - 1) * size, page * size),
        total: 5,
        page,
        pageSize: size,
      });
    }),
  };
  const adapted = adaptMockToWorker(inner);
  const result = JSON.parse(
    await adapted.call('access.audit.list', JSON.stringify({ cursor: '1', limit: 3 }), ''),
  );
  expect(result.data.entries.map((e: { id: string }) => e.id)).toEqual(['e1', 'e2', 'e3']);
  expect(result.data.nextCursor).toBe('4');
});

test('qrcodes.export menjadi job selesai yang dapat dibaca lewat jobs.get', async () => {
  const inner = innerReturning({ 'qrcodes.export': { id: 'd1' } });
  const adapted = adaptMockToWorker(inner);
  const queued = JSON.parse(await adapted.call('qrcodes.export', JSON.stringify({ id: 'd1' }), ''));
  expect(queued.data.jobId).toMatch(/^mock-job-/);
  const job = JSON.parse(
    await adapted.call('jobs.get', JSON.stringify({ id: queued.data.jobId }), ''),
  );
  expect(job.data).toMatchObject({ status: 'done', progress: 100, kind: 'qr_export' });
  const missing = JSON.parse(await adapted.call('jobs.get', JSON.stringify({ id: 'x' }), ''));
  expect(missing.error.code).toBe('NOT_FOUND');
});

test('method lain diteruskan apa adanya', async () => {
  const inner = innerReturning({ 'auth.me': { email: 'a' } });
  expect(await adaptMockToWorker(inner).call('auth.me', 'null', 't')).toBe(env({ email: 'a' }));
});
