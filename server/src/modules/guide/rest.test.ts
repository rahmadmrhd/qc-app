import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { GUIDE_VERSIONS } from '@shared/guides';

setDefaultTimeout(60_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const A = 'a@gmail.com';
const B = 'b@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-13T03:00:00.000Z'));
  rest = restClient(env);
  // Pengguna tanpa izin apa pun: membuktikan rute panduan hanya butuh sesi aktif.
  await seedUser(env, { id: 'u-a', email: A });
  await seedUser(env, { id: 'u-b', email: B });
});

async function list(email: string): Promise<unknown> {
  const response = await rest.get('/guides', { email });
  expect(response.status).toBe(200);
  return response.json();
}

async function rowCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM guide_progress').first<{
    n: number | string;
  }>();
  return Number(row?.n ?? 0);
}

describe('guides.list / guides.mark / guides.reset', () => {
  test('pengguna baru: daftar kosong', async () => {
    expect(await list(A)).toEqual([]);
  });

  test('mark lalu list', async () => {
    const marked = await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual([{ id: 'dasar-layout', version: 1 }]);
    expect(await list(A)).toEqual([{ id: 'dasar-layout', version: 1 }]);
  });

  test('mark idempoten dan versi tersimpan tidak pernah turun', async () => {
    // Versi katalog saat ini 1; versi lebih tinggi disimulasikan langsung di tabel (kenaikan versi katalog kelak).
    await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    expect(await rowCount()).toBe(1);
    await env.DB.prepare('UPDATE guide_progress SET `version` = 5').run();
    const again = await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    expect(await again.json()).toEqual([{ id: 'dasar-layout', version: 5 }]);
  });

  test('email dinormalisasi: sesi huruf besar tetap satu baris yang sama', async () => {
    await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    expect(await list('A@Gmail.com')).toEqual([{ id: 'dasar-layout', version: 1 }]);
    const row = await env.DB.prepare('SELECT recipient FROM guide_progress').first<{
      recipient: string;
    }>();
    expect(row?.recipient).toBe(A);
  });

  test('progres milik pemanggil saja', async () => {
    await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    expect(await list(B)).toEqual([]);
    await rest.put('/guides/sapaan-awal', { email: B, body: { version: 1 } });
    expect(await list(A)).toEqual([{ id: 'dasar-layout', version: 1 }]);
    // Reset oleh B tidak menghapus progres A.
    const reset = await rest.post('/guides/dasar-layout/reset', { email: B });
    expect(reset.status).toBe(200);
    expect(await list(A)).toEqual([{ id: 'dasar-layout', version: 1 }]);
    expect(await list(B)).toEqual([{ id: 'sapaan-awal', version: 1 }]);
  });

  test('reset menghapus baris panduan itu saja', async () => {
    await rest.put('/guides/dasar-layout', { email: A, body: { version: 1 } });
    await rest.put('/guides/sapaan-awal', { email: A, body: { version: 1 } });
    const reset = await rest.post('/guides/dasar-layout/reset', { email: A });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual([{ id: 'sapaan-awal', version: 1 }]);
    // Reset tanpa baris = tak berbuat apa-apa.
    const none = await rest.post('/guides/dasar-layout/reset', { email: A });
    expect(none.status).toBe(200);
  });

  test('masukan tidak valid = 422 VALIDATION dan tabel tidak berubah', async () => {
    const over = GUIDE_VERSIONS['dasar-layout'] + 1;
    const cases: Array<[string, unknown]> = [
      ['/guides/tidak-ada', { version: 1 }],
      ['/guides/dasar-layout', { version: 0 }],
      ['/guides/dasar-layout', { version: -1 }],
      ['/guides/dasar-layout', { version: 1.5 }],
      ['/guides/dasar-layout', { version: '1' }],
      ['/guides/dasar-layout', { version: over }],
      ['/guides/dasar-layout', {}],
    ];
    for (const [path, body] of cases) {
      const response = await rest.put(path, { email: A, body });
      expect(response.status).toBe(422);
      expect((await jsonOf(response)).code).toBe('VALIDATION');
    }
    const reset = await rest.post('/guides/tidak-ada/reset', { email: A });
    expect(reset.status).toBe(422);
    expect((await jsonOf(reset)).code).toBe('VALIDATION');
    expect(await rowCount()).toBe(0);
  });

  test('tanpa sesi -> 401', async () => {
    expect((await rest.get('/guides', { email: null })).status).toBe(401);
    const put = await rest.put('/guides/dasar-layout', { email: null, body: { version: 1 } });
    expect(put.status).toBe(401);
    expect((await rest.post('/guides/dasar-layout/reset', { email: null })).status).toBe(401);
  });
});
