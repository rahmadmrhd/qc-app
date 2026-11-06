import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV, seedHandoverEnv } from '@server-test/handover-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { HANDOVER_BATCH_MAX } from '@shared/handover';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const LOC = `locationIds=${ENV.locA}`;
const task = (n: number) => ({ customerName: `PT ${n}`, note: `- [ ] butir ${n}` });

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
  rest = restClient(env);
  await seedHandoverEnv(env);
});

async function createOne(note = '- [ ] A = 1', customerName = 'PT Maju') {
  const response = await rest.post('/handovers', {
    email: 'wh@gmail.com',
    body: { locationId: ENV.locA, customerName, note },
  });
  expect(response.status).toBe(201);
  return { response, task: await jsonOf(response) };
}

test('batas batch M2 = 30', () => {
  expect(HANDOVER_BATCH_MAX).toBe(30);
});

describe('buat, baca, ubah', () => {
  test('POST /handovers -> 201 + Location + ETag = updatedAt; GET tunggal ber-ETag dan 304', async () => {
    const { response, task: created } = await createOne();
    const id = created.id as string;
    expect(response.headers.get('location')).toBe(`/api/v1/handovers/${id}`);
    expect(response.headers.get('etag')).toBe(`"${created.updatedAt as string}"`);
    const got = await rest.get(`/handovers/${id}?${LOC}`, { email: 'wh@gmail.com' });
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBe(`"${created.updatedAt as string}"`);
    const cached = await rest.get(`/handovers/${id}?${LOC}`, {
      email: 'wh@gmail.com',
      headers: { 'if-none-match': got.headers.get('etag') as string },
    });
    expect(cached.status).toBe(304);
  });

  test('PUT dengan If-Match basi -> 412 problem+json (code CONFLICT), tanpa membocorkan catatan penulis lain', async () => {
    const { task: created } = await createOne('- [ ] awal');
    const id = created.id as string;
    const ifMatch = { 'if-match': `"${created.updatedAt as string}"` };
    env.clock.advance(2000);
    const first = await rest.put(`/handovers/${id}`, {
      email: 'wh@gmail.com',
      headers: ifMatch,
      body: { locationId: ENV.locA, customerName: 'PT Maju', note: '- [ ] RAHASIA-PERTAMA' },
    });
    expect(first.status).toBe(200);
    env.clock.advance(2000);
    const second = await rest.put(`/handovers/${id}`, {
      email: 'wh@gmail.com',
      headers: ifMatch,
      body: { locationId: ENV.locA, customerName: 'PT Maju', note: '- [ ] penulis kedua' },
    });
    expect(second.status).toBe(412);
    expect(second.headers.get('content-type')).toContain('application/problem+json');
    const problem = await jsonOf(second);
    expect(problem).toMatchObject({ code: 'CONFLICT', status: 412 });
    expect(JSON.stringify(problem)).not.toContain('RAHASIA-PERTAMA');
  });

  test('id jalur menang atas badan: id badan berbeda -> 422', async () => {
    const { task: created } = await createOne();
    const response = await rest.put(`/handovers/${created.id as string}`, {
      email: 'wh@gmail.com',
      body: { id: 'lain', locationId: ENV.locA, customerName: 'X', note: 'x' },
    });
    expect(response.status).toBe(422);
  });

  test('/handovers/options dan /handovers/batch tidak tertelan /handovers/{id}', async () => {
    const options = await rest.get(`/handovers/options?${LOC}`, { email: 'wh@gmail.com' });
    expect(options.status).toBe(200);
    expect(await jsonOf(options)).toHaveProperty('customers');
    const batch = await rest.post('/handovers/batch', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA, tasks: [task(1)] },
    });
    expect(batch.status).toBe(201);
  });
});

describe('aksi pada task', () => {
  test('PUT /handovers/{id}/checks dua kali dengan isi sama: hasil identik, tanpa 409 (idempoten)', async () => {
    const { task: created } = await createOne('- [ ] A = 1\n- [ ] B = 2');
    const id = created.id as string;
    const body = { locationId: ENV.locA, index: 0, text: 'A = 1', checked: true };
    const first = await rest.put(`/handovers/${id}/checks`, { email: 'qc@gmail.com', body });
    expect(first.status).toBe(200);
    const second = await rest.put(`/handovers/${id}/checks`, { email: 'qc@gmail.com', body });
    expect(second.status).toBe(200);
    const a = await jsonOf(first);
    const b = await jsonOf(second);
    expect(b).toEqual(a);
    expect((a.checklist as Array<{ checked: boolean }>)[0]?.checked).toBe(true);
    // teks usang tetap CONFLICT
    const stale = await rest.put(`/handovers/${id}/checks`, {
      email: 'qc@gmail.com',
      body: { ...body, text: 'tidak ada' },
    });
    expect(stale.status).toBe(409);
  });

  test('POST /handovers/{id}/comments -> 201; cancel, reopen, done lewat POST dengan badan { locationId }', async () => {
    const { task: created } = await createOne();
    const id = created.id as string;
    const comment = await rest.post(`/handovers/${id}/comments`, {
      email: 'viewer@gmail.com',
      body: { locationId: ENV.locA, quote: '', before: '', after: '', body: 'halo' },
    });
    expect(comment.status).toBe(201);
    expect((await jsonOf(comment)).comments).toHaveLength(1);
    const cancel = await rest.post(`/handovers/${id}/cancel`, {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA },
    });
    expect(cancel.status).toBe(200);
    expect(await jsonOf(cancel)).toMatchObject({ status: 'cancelled' });
    const reopen = await rest.post(`/handovers/${id}/reopen`, {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA },
    });
    expect(await jsonOf(reopen)).toMatchObject({ status: 'new' });
    const done = await rest.post(`/handovers/${id}/done`, {
      email: 'qc@gmail.com',
      body: { locationId: ENV.locA },
    });
    expect(done.status).toBe(200);
  });

  test('lokasi di luar akses -> 403 (baca, tulis, dan aksi)', async () => {
    const { task: created } = await createOne();
    const id = created.id as string;
    const read = await rest.get(`/handovers/${id}?locationIds=${ENV.locB}`, {
      email: 'viewer@gmail.com',
    });
    expect(read.status).toBe(403);
    const board = await rest.get(`/handovers?locationIds=${ENV.locB}&status=new`, {
      email: 'viewer@gmail.com',
    });
    expect(board.status).toBe(403);
    const write = await rest.post('/handovers', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locB, customerName: 'X', note: 'x' },
    });
    expect(write.status).toBe(403);
    const action = await rest.post(`/handovers/${id}/cancel`, {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locB },
    });
    expect(action.status).toBe(403);
  });
});

describe('POST /handovers/batch (M2: maks. 30, atomik)', () => {
  const tasks = (count: number) => Array.from({ length: count }, (_, i) => task(i + 1));
  const handoverCount = async () =>
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM handovers').first<{ n: number }>())?.n;

  test('31 task -> 422 dengan fields.tasks; tidak ada yang tersimpan', async () => {
    const response = await rest.post('/handovers/batch', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA, tasks: tasks(31) },
    });
    expect(response.status).toBe(422);
    expect(await jsonOf(response)).toMatchObject({
      code: 'VALIDATION',
      fields: { tasks: `Maksimal ${HANDOVER_BATCH_MAX} task per permintaan` },
    });
    expect(await handoverCount()).toBe(0);
  });

  test('30 task diterima dalam SATU permintaan: nomor 001..030 berurutan tanpa ganda', async () => {
    const response = await rest.post('/handovers/batch', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA, tasks: tasks(30) },
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as Array<{ number: string }>;
    expect(created.map((entry) => entry.number)).toEqual(
      Array.from({ length: 30 }, (_, i) => `ST-20261015-${String(i + 1).padStart(3, '0')}`),
    );
  });

  test('atomik: satu task bermasalah di antara 30 -> 422 dan TIDAK ADA task, customer, atau nomor terpakai', async () => {
    const bad = tasks(30);
    bad[17] = { customerName: 'PT Rusak', note: 'x'.repeat(5001) };
    const response = await rest.post('/handovers/batch', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA, tasks: bad },
    });
    expect(response.status).toBe(422);
    expect(await jsonOf(response)).toMatchObject({
      fields: { tasks: expect.stringContaining('Task 18') },
    });
    expect(await handoverCount()).toBe(0);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first<{ n: number }>())?.n,
    ).toBe(0);
    // nomor tidak terpakai: simpan berikutnya mulai dari 001
    const next = await rest.post('/handovers/batch', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA, tasks: tasks(1) },
    });
    expect(((await next.json()) as Array<{ number: string }>)[0]?.number).toBe('ST-20261015-001');
  });

  test('tanpa izin edit (QC) -> 403; kosong -> 422', async () => {
    const forbidden = await rest.post('/handovers/batch', {
      email: 'qc@gmail.com',
      body: { locationId: ENV.locA, tasks: tasks(1) },
    });
    expect(forbidden.status).toBe(403);
    const empty = await rest.post('/handovers/batch', {
      email: 'wh@gmail.com',
      body: { locationId: ENV.locA, tasks: [] },
    });
    expect(empty.status).toBe(422);
  });

  test('paralel lewat REST: batch 30 + batch 30 + save: nomor 001..61 tanpa ganda dan tanpa celah', async () => {
    const send = (path: string, body: unknown) => rest.post(path, { email: 'wh@gmail.com', body });
    const results = await Promise.all([
      send('/handovers/batch', { locationId: ENV.locA, tasks: tasks(30) }),
      send('/handovers/batch', { locationId: ENV.locA, tasks: tasks(30) }),
      send('/handovers', { locationId: ENV.locA, customerName: 'PT Satu', note: 'x' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const rows = await env.DB.prepare('SELECT number FROM handovers ORDER BY number').all<{
      number: string;
    }>();
    expect(rows.results.map((row) => row.number)).toEqual(
      Array.from({ length: 61 }, (_, i) => `ST-20261015-${String(i + 1).padStart(3, '0')}`),
    );
    const counter = await env.DB.prepare('SELECT COUNT(*) AS n FROM handovers').first<{
      n: number;
    }>();
    expect(counter?.n).toBe(61);
  });
});

describe('GET /handovers (board: bawaan 20, maks. 50)', () => {
  beforeEach(async () => {
    const statements = [];
    for (let i = 0; i < 57; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO handovers (id, number, location_id, note, updated_at, board_status, total_count) VALUES (?, ?, ?, '- [ ] a', ?, 'new', 1)",
        ).bind(
          `n${i}`,
          `ST-20261016-${String(i + 1).padStart(3, '0')}`,
          ENV.locA,
          `2026-10-16T00:00:${String(i % 40).padStart(2, '0')}.000Z`,
        ),
      );
    }
    await env.DB.batch(statements);
  });

  const page = async (query: string) => {
    const response = await rest.get(`/handovers?${LOC}&status=new${query}`, {
      email: 'wh@gmail.com',
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
      total: number;
    };
  };

  test('tanpa limit = 20 per halaman; total = jumlah kolom', async () => {
    const first = await page('');
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(57);
    expect(first.nextCursor).not.toBeNull();
  });

  test('limit=50 menelusuri semua task tepat sekali lewat kursor', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const result: Awaited<ReturnType<typeof page>> = await page(
        `&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(2);
    expect(seen).toHaveLength(57);
    expect(new Set(seen).size).toBe(57);
  });

  test('limit 51, 0, atau bukan angka -> 422; status tak dikenal -> 422', async () => {
    for (const limit of ['51', '0', 'abc']) {
      const response = await rest.get(`/handovers?${LOC}&status=new&limit=${limit}`, {
        email: 'wh@gmail.com',
      });
      expect(response.status).toBe(422);
    }
    const status = await rest.get(`/handovers?${LOC}&status=x`, { email: 'wh@gmail.com' });
    expect(status.status).toBe(422);
  });
});
