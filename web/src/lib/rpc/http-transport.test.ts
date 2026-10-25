import { expect, test, vi } from 'vitest';
import { createHttpTransport } from './http-transport';

function fetchReturning(body: string, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }));
}

test('POST /api/rpc dengan header CSRF, cookie same-origin, dan badan { method, payload }', async () => {
  const fetchImpl = fetchReturning('{"ok":true,"data":1}');
  const transport = createHttpTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
  await expect(transport.call('items.get', '{"id":"i1"}')).resolves.toBe('{"ok":true,"data":1}');
  const [url, init] = fetchImpl.mock.calls[0] ?? [];
  expect(url).toBe('/api/rpc');
  expect(init?.method).toBe('POST');
  expect(init?.credentials).toBe('same-origin');
  expect(init?.headers).toMatchObject({ 'X-Requested-With': 'qc' });
  expect(JSON.parse(String(init?.body))).toEqual({ method: 'items.get', payload: { id: 'i1' } });
});

test('amplop galat pada status non-200 dikembalikan apa adanya', async () => {
  const body = '{"ok":false,"error":{"code":"CONFLICT","message":"x","requestId":"r"}}';
  const transport = createHttpTransport({
    fetchImpl: fetchReturning(body, 409) as unknown as typeof fetch,
  });
  await expect(transport.call('a', 'null')).resolves.toBe(body);
});

test('401 tanpa amplop menjadi UNAUTHENTICATED; 503 menjadi UNAVAILABLE', async () => {
  const make = (status: number) =>
    createHttpTransport({
      fetchImpl: fetchReturning('<html>', status) as unknown as typeof fetch,
    });
  expect(JSON.parse(await make(401).call('a', 'null')).error.code).toBe('UNAUTHENTICATED');
  expect(JSON.parse(await make(503).call('a', 'null')).error.code).toBe('UNAVAILABLE');
  expect(JSON.parse(await make(429).call('a', 'null')).error.code).toBe('UNAVAILABLE');
});

test('galat jaringan dilempar; dua panggilan serentak = dua permintaan terpisah', async () => {
  const failing = vi.fn(async () => Promise.reject(new TypeError('offline')));
  await expect(
    createHttpTransport({ fetchImpl: failing as unknown as typeof fetch }).call('a', 'null'),
  ).rejects.toThrow('offline');
  const fetchImpl = fetchReturning('{"ok":true,"data":null}');
  const transport = createHttpTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
  await Promise.all([transport.call('a', 'null'), transport.call('b', 'null')]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('baseUrl dipakai sebagai awalan', async () => {
  const fetchImpl = fetchReturning('{"ok":true,"data":null}');
  await createHttpTransport({
    baseUrl: 'http://localhost:8787/',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  }).call('a', 'null');
  expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://localhost:8787/api/rpc');
});
