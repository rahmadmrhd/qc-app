import { beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { app, createApp } from '@server/app';
import { appError } from '@server/core/errors';
import { signSessionToken } from '@server/core/session';
import { getRoutes } from '@server/routes';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { SYNC_TEST_TOKEN, type SyncOut, syncCall, syncSend } from '@server-test/sync-rest';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { SYNC_API_ROUTES, type SyncRouteId } from '@shared/api';
import { SYNC_ACTOR } from '@shared/sync';
import { planDriveFiles, probeDriveIds, registerDriveFiles } from './files';
import { syncRoute } from './handler';
import { syncRoutes } from './routes';
import { currentSyncRev } from './state';

const TOKEN = SYNC_TEST_TOKEN;
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
// Banyak tes memanggil MariaDB lewat jaringan (terowongan SSH saat dev).
setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv({ SYNC_API_TOKEN: TOKEN });
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
});

/** Id handler dari nama metode lama (`sync.items.push` dst.): sama dengan kunci `SYNC_API_ROUTES`. */
const call = (method: string, payload: unknown): Promise<SyncOut> =>
  syncCall(env, method as SyncRouteId, payload);
const ping = (token: string | null) => syncCall(env, 'sync.ping', null, { token });
const pingFrom = (clientIp: string, token: string | null) =>
  syncCall(env, 'sync.ping', null, { token, clientIp });

async function prime(resource: 'brands' | 'items', count: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seq = VALUES(seq)',
  )
    .bind(resource, count, '2026-01-01T00:00:00.000Z')
    .run();
}

async function audits() {
  const rows = await env.DB.prepare('SELECT actor, action, target FROM audit_log ORDER BY id').all<{
    actor: string;
    action: string;
    target: string;
  }>();
  return rows.results;
}

async function brandsInDb() {
  const rows = await env.DB.prepare(
    'SELECT id, name, external_id, status, sync_rev FROM brands ORDER BY name',
  ).all<{ id: string; name: string; external_id: string; status: string; sync_rev: number }>();
  return rows.results;
}

/** Badan problem+json tanpa `requestId` (acak per permintaan), plus header yang relevan untuk perbandingan. */
async function problemShape(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  const { requestId, ...rest } = body;
  expect(typeof requestId).toBe('string');
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    authenticate: response.headers.get('www-authenticate'),
    body: rest,
  };
}

describe('handler (REST /api/v1/sync/*)', () => {
  test('sync.ping dengan token benar mengembalikan versi API 2, waktu server, dan sumber daya', async () => {
    const response = await syncSend(env, 'sync.ping', null);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      apiVersion: 2,
      serverTime: '2026-10-15T03:00:00.000Z',
      resources: ['brands', 'items'],
    });
  });

  test('semua kegagalan sebelum autentikasi menghasilkan 401 yang SAMA (badan, header; sebab tak terbedakan)', async () => {
    const bearer = (value: string) => ({ authorization: value });
    const responses = await Promise.all([
      syncSend(env, 'sync.ping', null, { token: 'salah' }), // token salah
      syncSend(env, 'sync.ping', null, { token: null }), // header tidak ada
      syncSend(env, 'sync.ping', null, { token: null, headers: bearer(`Basic ${TOKEN}`) }), // bukan Bearer
      syncSend(env, 'sync.ping', null, { token: null, headers: bearer('Bearer') }), // Bearer tanpa token
      syncSend(env, 'sync.ping', null, { token: null, headers: bearer(`Bearer a ${TOKEN}`) }), // spasi di token
      syncSend(env, 'sync.ping', null, { token: null, headers: bearer(TOKEN) }), // tanpa skema
      syncSend(env, 'sync.ping', null, { token: 'x'.repeat(5000) }), // token sangat panjang
      syncSend(env, 'sync.brands.pull', { limit: 0 }, { token: 'salah' }), // input buruk TIDAK diperiksa dulu
      syncSend(env, 'sync.items.push', null, { token: 'salah', raw: 'bukan json' }),
      syncSend(env, 'sync.items.push', null, { token: 'salah', raw: 'x'.repeat(5_000_001) }),
      syncSend(env, 'sync.file.get', { driveId: 'apa-saja' }, { token: 'salah' }),
    ]);
    const shapes: Awaited<ReturnType<typeof problemShape>>[] = [];
    for (const response of responses) shapes.push(await problemShape(response));
    expect(shapes[0]).toMatchObject({
      status: 401,
      contentType: 'application/problem+json; charset=utf-8',
      cacheControl: 'no-store',
      authenticate: 'Bearer',
      body: { code: 'UNAUTHENTICATED', detail: 'Token tidak valid', status: 401 },
    });
    for (const shape of shapes) expect(JSON.stringify(shape)).toBe(JSON.stringify(shapes[0]));
  });

  test('sebab lain yang juga seragam: IP diblokir, token server belum diset/terlalu pendek', async () => {
    const reference = await problemShape(
      await syncSend(env, 'sync.ping', null, { token: 'salah' }),
    );
    // diblokir: token benar pun ditolak dengan badan yang sama
    for (let i = 0; i < 10; i++) await ping(`salah-${i}`);
    expect(await problemShape(await syncSend(env, 'sync.ping', null))).toEqual(reference);
    const empty = await createTestEnv({ SYNC_API_TOKEN: '' });
    expect(
      await problemShape(await syncSend(empty, 'sync.ping', null, { token: 'apa saja pun' })),
    ).toEqual(reference);
    const short = await createTestEnv({ SYNC_API_TOKEN: 'pendek' });
    expect(
      await problemShape(await syncSend(short, 'sync.ping', null, { token: 'pendek' })),
    ).toEqual(reference);
  });

  test('token HANYA lewat header Authorization: di query atau badan tidak diterima', async () => {
    const viaQuery = await app.request(`https://qc.test/api/v1/sync/ping?token=${TOKEN}`, {}, env);
    expect(viaQuery.status).toBe(401);
    const viaBody = await syncSend(
      env,
      'sync.items.push',
      { token: TOKEN, items: [{ name: 'X' }] },
      { token: null },
    );
    expect(viaBody.status).toBe(401);
    const scheme = await syncSend(env, 'sync.ping', null, {
      token: null,
      headers: { authorization: `bearer ${TOKEN}` },
    });
    expect(scheme.status).toBe(200); // skema tak peka huruf (RFC 9110)
  });

  test('VALIDATION dan NOT_FOUND hanya muncul setelah token benar', async () => {
    expect((await syncSend(env, 'sync.brands.pull', { limit: 0 }, { token: 'salah' })).status).toBe(
      401,
    );
    expect(await call('sync.brands.pull', { limit: 0 })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', status: 422, fields: { limit: expect.any(String) } },
    });
    expect(await call('sync.file.get', { driveId: 'tidak-ada' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', status: 404 },
    });
  });

  test('query pull yang salah bentuk -> 422 dengan nama field (bukan angka)', async () => {
    expect(await call('sync.items.pull', { sinceRev: 'abc' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', status: 422, fields: { sinceRev: expect.any(String) } },
    });
  });

  const UNKNOWN_SYNC_ROUTES = [
    ['GET', '/sync/tidak-ada'],
    ['GET', '/sync/constructor'],
    ['GET', '/sync/__proto__'],
    ['POST', '/sync/ping'],
    ['GET', '/sync/items/push'],
    ['GET', '/sync'],
  ] as const;
  const probe = (method: string, path: string, token: string | null) =>
    app.request(
      `https://qc.test/api/v1${path}`,
      { method, headers: token === null ? {} : { authorization: `Bearer ${token}` } },
      env,
    );

  test('rute /api/v1/sync/* yang tidak ada, nama bawaan Object, atau verba keliru: 401 seragam tanpa token, 404 problem+json dengan token sah', async () => {
    const reference = await problemShape(
      await syncSend(env, 'sync.ping', null, { token: 'salah' }),
    );
    // 6 probe tanpa token (< 10 kegagalan) agar IP belum diblokir saat probe bertoken sah
    for (const [method, path] of UNKNOWN_SYNC_ROUTES) {
      // keberadaan rute tidak terungkap tanpa token (sama dengan 401 rute yang ada)
      expect(await problemShape(await probe(method, path, null)), `${method} ${path}`).toEqual(
        reference,
      );
      const found = await probe(method, path, TOKEN);
      expect(found.status).toBe(404);
      expect(found.headers.get('content-type')).toContain('application/problem+json');
      expect(await found.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  test('probe rute tak dikenal ikut dihitung pembatas: 10 probe tanpa token memblokir IP (token benar pun ditolak)', async () => {
    for (let i = 0; i < 10; i++) await probe('GET', `/sync/probe-${i}`, null);
    expect(await ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  test('POST /sync (kabel lama beramplop) sudah dihapus: 404 problem+json untuk semua metode dan turunannya', async () => {
    const envelope = JSON.stringify({ v: 1, method: 'sync.ping', token: TOKEN });
    for (const [method, path] of [
      ['POST', '/sync'],
      ['GET', '/sync'],
      ['POST', '/sync/ping'],
      ['POST', '/sync/items/push'],
    ] as const) {
      const response = await app.request(
        `https://qc.test${path}`,
        { method, body: method === 'POST' ? envelope : undefined },
        env,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  test('token tidak dikonfigurasi atau terlalu pendek: semua permintaan ditolak', async () => {
    const empty = await createTestEnv({ SYNC_API_TOKEN: '' });
    expect(await syncCall(empty, 'sync.ping', null, { token: 'apa saja' })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    const short = await createTestEnv({ SYNC_API_TOKEN: 'pendek' });
    expect(await syncCall(short, 'sync.ping', null, { token: 'pendek' })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  test('10 kegagalan memblokir IP itu, termasuk permintaannya yang bertoken benar (tabel rate_limits)', async () => {
    for (let i = 0; i < 9; i++) await ping(`salah-${i}`);
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    await ping('salah-9');
    expect(await ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const block = await env.DB.prepare(
      "SELECT count FROM rate_limits WHERE `key` = 'sync:blocked:unknown'",
    ).first();
    expect(block).not.toBeNull();
    // blokir berakhir setelah 10 menit
    env.clock.advance(10 * 60 * 1000 + 1);
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
  });

  test('token sinkron sebagai Bearer tidak berlaku di rute web: GET /me dan rute tulis = 401', async () => {
    const bearer = { authorization: `Bearer ${TOKEN}` };
    const me = await app.request('https://qc.test/api/v1/me', { headers: bearer }, env);
    expect(me.status).toBe(401);
    const write = await app.request(
      'https://qc.test/api/v1/brands',
      {
        method: 'POST',
        headers: { ...bearer, 'x-requested-with': 'qc', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Lewat Bearer' }),
      },
      env,
    );
    expect(write.status).toBe(401);
    expect(await brandsInDb()).toEqual([]);
  });

  test('pembatas per IP: IP yang diblokir tidak menghalangi IP lain, dan tiap IP dihitung sendiri', async () => {
    for (let i = 0; i < 10; i++) await pingFrom('203.0.113.7', `salah-${i}`);
    expect(await pingFrom('203.0.113.7', TOKEN)).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    // IP lain tetap bisa masuk, dan kegagalannya tidak menambah hitungan IP yang diblokir
    expect(await pingFrom('198.51.100.9', TOKEN)).toMatchObject({ ok: true });
    for (let i = 0; i < 9; i++) await pingFrom('198.51.100.9', `salah-${i}`);
    expect(await pingFrom('198.51.100.9', TOKEN)).toMatchObject({ ok: true });
    const keys = (
      await env.DB.prepare('SELECT `key` FROM rate_limits ORDER BY `key`').all<{ key: string }>()
    ).results.map((r) => r.key);
    expect(keys).toEqual(['sync:blocked:203.0.113.7', 'sync:fails:198.51.100.9']);
  });

  test('kegagalan serentak dihitung atomik (tanpa pembaruan hilang): 12 token salah paralel memblokir; hitungan di jendela = 0 setelah blokir', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => ping(`paralel-${i}`)));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(await ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const rows = await env.DB.prepare('SELECT `key`, count FROM rate_limits ORDER BY `key`').all<{
      key: string;
      count: number;
    }>();
    // blokir tercatat dan penghitung dibuang di transaksi blokir (juga oleh transaksi yang melihat blokir): hanya
    // baris sync:blocked:<ip> yang tersisa
    expect(rows.results.map((r) => r.key)).toEqual(['sync:blocked:unknown']);
  });

  const limiterRows = async () =>
    (
      await env.DB.prepare('SELECT `key`, count FROM rate_limits ORDER BY `key`').all<{
        key: string;
        count: number;
      }>()
    ).results;

  test('(N1) 25 permintaan SAH serentak semuanya diterima; permintaan sukses tidak dihitung sebagai kegagalan dan tidak menghapus baris (paling banyak menyisipkan penghitung bernilai 0)', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => ping(TOKEN)));
    expect(results.every((r) => r.ok)).toBe(true);
    // tidak ada kegagalan tercatat (baris bernilai 0 dipertahankan, lihat tes m1)
    expect((await limiterRows()).filter((r) => Number(r.count) > 0)).toEqual([]);
  });

  test('(m1) jalur sah tanpa sisip-lalu-hapus: baris penghitung bernilai 0 dipertahankan dan burst 60 permintaan sah semuanya diterima', async () => {
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    expect(await limiterRows()).toEqual([{ key: 'sync:fails:unknown', count: 0 }]);
    const results = await Promise.all(Array.from({ length: 60 }, () => ping(TOKEN)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await limiterRows()).toEqual([{ key: 'sync:fails:unknown', count: 0 }]);
    // baris bernilai 0 tidak melonggarkan atau mengetatkan: 10 kegagalan tetap memblokir
    for (let i = 0; i < 10; i++) await ping(`salah-${i}`);
    expect(await ping(TOKEN)).toMatchObject({ ok: false });
    expect((await limiterRows()).map((r) => r.key)).toEqual(['sync:blocked:unknown']);
  });

  test('(N1) 9 permintaan sah serentak + 1 token salah: semua yang sah sukses dan IP TIDAK terblokir (hanya 1 kegagalan)', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 9 }, () => ping(TOKEN)),
      ping('salah-tunggal'),
    ]);
    expect(results.slice(0, 9).every((r) => r.ok)).toBe(true);
    expect(results[9]?.ok).toBe(false);
    expect(await limiterRows()).toEqual([{ key: 'sync:fails:unknown', count: 1 }]);
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
  });

  test('(N1) 30 tebakan salah serentak lalu 10 token benar serentak: SEMUA ditolak (0 diterima setelah ambang); blokir tercatat, penghitung tidak tertinggal', async () => {
    const guesses = await Promise.all(Array.from({ length: 30 }, (_, i) => ping(`tebakan-${i}`)));
    expect(guesses.every((r) => !r.ok)).toBe(true);
    const correct = await Promise.all(Array.from({ length: 10 }, () => ping(TOKEN)));
    expect(correct.filter((r) => r.ok)).toHaveLength(0);
    const rows = await limiterRows();
    expect(rows.map((r) => r.key)).toEqual(['sync:blocked:unknown']);
    // IP lain tidak terdampak
    expect(await pingFrom('198.51.100.20', TOKEN)).toMatchObject({ ok: true });
  });

  test('(N1/N2) 30 salah + 30 benar tercampur serentak: tiap token salah ditolak, hitungan tidak pernah melampaui anggaran, dan setelahnya yang benar ditolak', async () => {
    const mixed = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0 ? ping(`campur-${i}`) : ping(TOKEN),
    );
    const results = await Promise.all(mixed);
    for (let i = 0; i < 60; i += 2) expect(results[i]?.ok).toBe(false);
    const rows = await limiterRows();
    expect(rows.map((r) => r.key)).toEqual(['sync:blocked:unknown']);
    expect(await ping(TOKEN)).toMatchObject({ ok: false });
    // tidak ada kegagalan yang hilang: 10 salah sudah cukup memblokir, dan blokir tetap sampai kedaluwarsa
    env.clock.advance(5 * 60 * 1000);
    expect(await ping(TOKEN)).toMatchObject({ ok: false });
  });

  test('(N2) 9 salah lalu 1 salah + 5 sah serentak: kegagalan ke-10 memblokir, penghitung dibuang, yang sah sesudahnya ditolak (tanpa 5xx)', async () => {
    for (let i = 0; i < 9; i++) await ping(`salah-${i}`);
    const results = await Promise.all([
      ping('salah-ke-10'),
      ...Array.from({ length: 5 }, () => ping(TOKEN)),
    ]);
    expect(results[0]?.ok).toBe(false);
    // yang sah yang diserialkan sebelum kegagalan ke-10 diterima, sesudahnya ditolak 401 (tidak pernah 5xx)
    for (const r of results.slice(1)) {
      expect(r.ok || r.error?.code === 'UNAUTHENTICATED').toBe(true);
    }
    expect(await ping(TOKEN)).toMatchObject({ ok: false });
    const rows = await limiterRows();
    expect(rows.map((r) => r.key)).toEqual(['sync:blocked:unknown']);
  });

  test('(N3) deterministik: token benar yang lolos pra-pemeriksaan tepat sebelum blokir ter-commit tetap ditolak (blokir dibaca di dalam transaksi), tanpa bergantung urutan pool', async () => {
    const realTransaction = env.DB.transaction.bind(env.DB);
    let holdNext = true;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    env.DB.transaction = (async (fn: Parameters<typeof realTransaction>[0]) => {
      if (holdNext) {
        holdNext = false;
        reached(); // pra-pemeriksaan permintaan ini sudah lewat; transaksinya ditahan di gerbang
        await gate;
      }
      return realTransaction(fn);
    }) as typeof env.DB.transaction;
    try {
      const correct = ping(TOKEN); // pra-pemeriksaan blokir: belum ada blokir, lolos
      await held;
      // 10 tebakan salah (tidak ditahan) memblokir IP dan membuang penghitung
      for (let i = 0; i < 10; i++) expect((await ping(`gerbang-${i}`)).ok).toBe(false);
      const rows = await limiterRows();
      expect(rows.map((r) => r.key)).toEqual(['sync:blocked:unknown']);
      release();
      // transaksi yang tertahan kini berjalan: harus melihat blokir dan menolak (sebelumnya: hitungan mulai dari nol, diterima)
      expect(await correct).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
      expect((await limiterRows()).map((r) => r.key)).toEqual(['sync:blocked:unknown']);
    } finally {
      env.DB.transaction = realTransaction;
    }
  });

  test('kegagalan yang sudah tercatat tidak terhapus oleh keberhasilan: 9 salah lalu benar lalu 1 salah memblokir (tidak ada pelonggaran)', async () => {
    for (let i = 0; i < 9; i++) await ping(`salah-${i}`);
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    await ping('salah-9');
    expect(await ping(TOKEN)).toMatchObject({ ok: false });
  });

  test('jendela 10 menit: kegagalan yang jarang tidak menumpuk; 10 dalam jendela memblokir', async () => {
    for (let i = 0; i < 12; i++) {
      await ping(`salah-${i}`);
      env.clock.advance(9 * 60 * 1000);
    }
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    for (let i = 0; i < 10; i++) await ping(`cepat-${i}`);
    expect(await ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  test('cookie sesi TIDAK diterima di rute sinkron; Bearer + cookie memakai Bearer; tanpa CSRF', async () => {
    const session = await signSessionToken(env, 'admin@gmail.com', env.clock.now());
    const cookie = { cookie: `qc_session=${session}` };
    // sesi sah tanpa Bearer -> 401 seragam
    const reference = await problemShape(
      await syncSend(env, 'sync.ping', null, { token: 'salah' }),
    );
    expect(
      await problemShape(await syncSend(env, 'sync.ping', null, { token: null, headers: cookie })),
    ).toEqual(reference);
    // token sesi sebagai Bearer -> 401; token sinkron sebagai cookie di rute web -> 401
    expect(await ping(session)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const web = await app.request(
      'https://qc.test/api/v1/me',
      { headers: { cookie: `qc_session=${TOKEN}` } },
      env,
    );
    expect(web.status).toBe(401);
    // Bearer sah + cookie sah/rusak: Bearer yang dipakai (hasil sama), cookie tidak dibaca
    expect((await syncSend(env, 'sync.ping', null, { headers: cookie })).status).toBe(200);
    expect(
      (await syncSend(env, 'sync.ping', null, { headers: { cookie: 'qc_session=rusak' } })).status,
    ).toBe(200);
    // metode tulis tanpa X-Requested-With: qc tetap diproses (tanpa csrfGuard)
    const push = await syncSend(env, 'sync.brands.push', { brands: [{ name: 'Tanpa Csrf' }] });
    expect(push.status).toBe(200);
  });

  test('galat tak terduga di handler menjadi INTERNAL (500) tanpa membocorkan detail', async () => {
    const boom = createApp(getRoutes(), {
      'sync.ping': syncRoute({
        validate: () => null,
        handler: () => {
          throw new Error('rahasia internal');
        },
      }),
    });
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await syncSend(env, 'sync.ping', null, {}, boom);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({
        code: 'INTERNAL',
        detail: 'Terjadi kesalahan pada server',
      });
      expect(text).not.toContain('rahasia');
    } finally {
      error.mockRestore();
    }
  });

  test('UNAVAILABLE dari handler = 503 problem+json dengan Retry-After (kontrak versi 2 mengenal UNAVAILABLE)', async () => {
    const down = createApp(getRoutes(), {
      'sync.ping': syncRoute({
        validate: () => null,
        handler: () => {
          throw appError('UNAVAILABLE', 'Layanan sedang tidak dapat dihubungi');
        },
      }),
    });
    const response = await syncSend(env, 'sync.ping', null, {}, down);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await response.json()).toMatchObject({
      code: 'UNAVAILABLE',
      detail: 'Layanan sedang tidak dapat dihubungi',
    });
  });

  test('handler menerima konteks dengan pelaku sync:desktop dan tanpa user', async () => {
    let seen: unknown;
    const spy = createApp(getRoutes(), {
      'sync.ping': syncRoute({
        validate: () => null,
        handler: (_input, ctx) => {
          seen = ctx;
          return 1;
        },
      }),
    });
    await syncSend(env, 'sync.ping', null, {}, spy);
    expect(seen).toMatchObject({ actor: SYNC_ACTOR });
    expect(Object.keys(seen as object).sort()).toEqual(['actor', 'env', 'requestId']);
  });

  test('header Authorization dan token tidak pernah masuk log (sukses maupun gagal)', async () => {
    const lines: string[] = [];
    const sink = (...args: unknown[]) => {
      lines.push(JSON.stringify(args));
    };
    const log = spyOn(console, 'log').mockImplementation(sink);
    const warn = spyOn(console, 'warn').mockImplementation(sink);
    const error = spyOn(console, 'error').mockImplementation(sink);
    try {
      await ping(TOKEN);
      await ping('salah-rahasia-123');
      await syncSend(env, 'sync.brands.pull', { limit: 0 });
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const all = lines.join('\n');
    expect(all).toContain('"evt":"sync"');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('salah-rahasia-123');
    expect(all.toLowerCase()).not.toContain('bearer');
  });

  test('badan push: batas 5 MB milik sinkron (bukan 2 MB JSON) dan baru dibaca setelah token sah', async () => {
    // 3 MB (> 2 MB batas JSON web) diterima: nama terlalu panjang = invalid per entri, bukan 413
    const big = await syncCall(env, 'sync.brands.push', {
      brands: [{ name: 'x'.repeat(3_000_000) }],
    });
    expect(big).toMatchObject({ ok: true, data: { results: [{ status: 'invalid' }] } });
    // > 5 MB = 413 problem+json
    const tooLarge = await syncCall(env, 'sync.brands.push', null, { raw: 'x'.repeat(5_000_001) });
    expect(tooLarge).toMatchObject({ ok: false, error: { code: 'VALIDATION', status: 413 } });
    // token salah + badan besar = 401 (badan tidak dibaca)
    const unauthenticated = await syncSend(env, 'sync.brands.push', null, {
      token: 'salah',
      raw: 'x'.repeat(5_000_001),
    });
    expect(unauthenticated.status).toBe(401);
    // bukan JSON = 400
    const notJson = await syncSend(env, 'sync.brands.push', null, { raw: '{bukan json' });
    expect(notJson.status).toBe(400);
  });

  test('tabel rute: tiap id SYNC_API_ROUTES punya handler terdaftar dan sebaliknya', () => {
    expect(Object.keys(syncRoutes()).sort()).toEqual(Object.keys(SYNC_API_ROUTES).sort());
  });
});

describe('brands', () => {
  const push = (brands: unknown[], extra: Record<string, unknown> = {}) =>
    call('sync.brands.push', { brands, ...extra });
  const results = async (brands: unknown[], extra: Record<string, unknown> = {}) => {
    const out = await push(brands, extra);
    if (!out.ok) throw new Error(JSON.stringify(out.error));
    return out.data.results as Array<Record<string, any>>;
  };

  test('pull: halaman berurutan menurut rev, tepat sekali, kursor = rev terakhir; sinceRev menyaring', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedBrand(env, `Merk ${i}`, { syncRev: i * 10, externalId: i === 2 ? '77' : '' });
    }
    await seedBrand(env, 'Lama', { syncRev: 0 });
    const seen: string[] = [];
    let since = 0;
    for (let guard = 0; guard < 10; guard++) {
      const page = await call('sync.brands.pull', { sinceRev: since, limit: 2 });
      expect(page.ok).toBe(true);
      seen.push(...page.data.brands.map((b: { name: string }) => b.name));
      since = page.data.nextRev;
      if (!page.data.hasMore) break;
    }
    expect(seen).toEqual(['Merk 1', 'Merk 2', 'Merk 3', 'Merk 4', 'Merk 5']);
    expect(since).toBe(50);
    const one = await call('sync.brands.pull', { sinceRev: 10, limit: 1 });
    expect(one.data.brands[0]).toEqual({
      uid: 'brand-merk-2',
      id: '77',
      name: 'Merk 2',
      active: true,
      rev: 20,
    });
    expect((await call('sync.brands.pull', { sinceRev: 50 })).data).toEqual({
      brands: [],
      nextRev: 50,
      hasMore: false,
    });
    expect((await call('sync.brands.pull', null)).data.brands).toHaveLength(5);
  });

  test('pull: query tidak sah -> VALIDATION (422); merk tidak menerima include (seperti v1)', async () => {
    for (const payload of [
      { sinceRev: -1 },
      { sinceRev: 1.5 },
      { limit: 0 },
      { limit: 501 },
      { include: ['detail'] },
      { include: 'detail' },
    ]) {
      expect(await call('sync.brands.pull', payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION', status: 422 },
      });
    }
  });

  test('push merk baru: created, dipetakan ke id MySQL, audit atas nama sync:desktop; diulang -> unchanged', async () => {
    const [first] = await results([{ id: '3', name: 'Ubiquiti' }]);
    expect(first).toMatchObject({ index: 0, status: 'created', rev: 1 });
    expect(typeof first?.uid).toBe('string');
    expect(await brandsInDb()).toEqual([
      { id: first?.uid, name: 'Ubiquiti', external_id: '3', status: 'active', sync_rev: 1 },
    ]);
    expect((await audits()).at(-1)).toEqual({
      actor: SYNC_ACTOR,
      action: 'brand.create',
      target: 'Ubiquiti',
    });
    const count = (await audits()).length;
    const [again] = await results([{ id: '3', name: 'Ubiquiti' }]);
    expect(again).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: 1 });
    expect(await audits()).toHaveLength(count);
  });

  test('push mencocokkan uid, lalu id MySQL, lalu nama; pemetaan saja -> updated tanpa kenaikan rev', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 5 });
    const [mapped] = await results([{ id: '3', name: 'ubiquiti' }]);
    expect(mapped).toMatchObject({ status: 'updated', uid: 'brand-ubiquiti', rev: 5 });
    expect((await brandsInDb())[0]).toMatchObject({
      name: 'Ubiquiti',
      external_id: '3',
      sync_rev: 5,
    });
    expect((await results([{ id: '3', name: 'Ubiquiti' }]))[0]).toMatchObject({
      status: 'unchanged',
    });
    expect((await results([{ uid: 'brand-ubiquiti', active: true }]))[0]?.status).toBe('unchanged');
  });

  test('ganti nama lewat push: rev naik, kunci dan rev item merk itu ikut berubah, audit brand.update', async () => {
    await prime('brands', 5);
    await prime('items', 8);
    await seedBrand(env, 'Ubiquity', { syncRev: 5 });
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'ES 24', syncRev: 8 });
    const [renamed] = await results([{ uid: 'brand-ubiquity', name: 'Ubiquiti', baseRev: 5 }]);
    expect(renamed?.status).toBe('updated');
    expect((renamed?.rev ?? 0) > 5).toBe(true);
    const item = await env.DB.prepare("SELECT `key`, sync_rev FROM items WHERE id = 'i1'").first<{
      key: string;
      sync_rev: number;
    }>();
    expect(item?.key).toBe('ubiquiti es 24');
    expect((item?.sync_rev ?? 0) > 8).toBe(true);
    expect((await audits()).at(-1)).toMatchObject({ actor: SYNC_ACTOR, action: 'brand.update' });
  });

  test('konflik: baseRev basi + nilai berbeda -> conflict tanpa perubahan; baseRev terkini, overwrite, atau nilai sama berhasil', async () => {
    await prime('brands', 5);
    await seedBrand(env, 'A', { syncRev: 5 });
    const [stale] = await results([{ uid: 'brand-a', name: 'B', baseRev: 3 }]);
    expect(stale).toMatchObject({
      status: 'conflict',
      uid: 'brand-a',
      rev: 5,
      current: { uid: 'brand-a', name: 'A', active: true, rev: 5 },
    });
    expect((await brandsInDb())[0]?.name).toBe('A');
    expect((await audits()).at(-1)).toMatchObject({
      actor: SYNC_ACTOR,
      action: 'brand.sync.conflict',
    });
    expect((await results([{ uid: 'brand-a', name: 'B' }]))[0]?.status).toBe('conflict');
    expect(
      (await results([{ uid: 'brand-a', name: 'B', baseRev: 3 }], { overwrite: true }))[0]?.status,
    ).toBe('updated');
    expect((await brandsInDb())[0]?.name).toBe('B');
    const rev = (await brandsInDb())[0]?.sync_rev;
    expect((await results([{ uid: 'brand-a', name: 'C', baseRev: rev }]))[0]?.status).toBe(
      'updated',
    );
    expect((await results([{ uid: 'brand-a', name: 'C', baseRev: 1 }]))[0]?.status).toBe(
      'unchanged',
    );
  });

  test('nonaktifkan lewat active:false; pull menampilkan active:false', async () => {
    await prime('brands', 1);
    await seedBrand(env, 'A', { syncRev: 1 });
    expect((await results([{ uid: 'brand-a', active: false, baseRev: 1 }]))[0]?.status).toBe(
      'updated',
    );
    expect((await brandsInDb())[0]?.status).toBe('inactive');
    expect((await call('sync.brands.pull', {})).data.brands[0]).toMatchObject({ active: false });
  });

  test('entri tidak sah menghasilkan invalid per field tanpa membatalkan entri lain; urutan hasil = urutan permintaan', async () => {
    const out = await results([
      { name: 'Valid 1' },
      { name: '' },
      { id: { x: 1 }, name: 'Y' },
      { uid: 'tidak-ada', name: 'Z' },
      { name: '!!!' },
      { active: true },
      'bukan objek',
      { name: 'Valid 2', id: 12 },
    ]);
    expect(out.map((r) => r.status)).toEqual([
      'created',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'created',
    ]);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out[1]?.fields).toEqual({ name: 'Wajib diisi' });
    expect(out[3]?.fields).toEqual({ uid: 'Merk tidak ditemukan' });
    expect(out[5]?.fields).toEqual({ name: 'Wajib diisi untuk merk baru' });
    const rows = await brandsInDb();
    expect(rows.map((b) => b.name)).toEqual(['Valid 1', 'Valid 2']);
    expect(rows.find((b) => b.name === 'Valid 2')?.external_id).toBe('12');
  });

  test('uid dan id yang mengarah ke merk berbeda, atau merk sudah terpetakan ke id lain -> conflict', async () => {
    await seedBrand(env, 'A', { externalId: '1', syncRev: 1 });
    await seedBrand(env, 'B', { externalId: '2', syncRev: 2 });
    expect((await results([{ uid: 'brand-a', id: '2' }]))[0]?.status).toBe('conflict');
    expect((await results([{ uid: 'brand-a', id: '9' }]))[0]?.status).toBe('conflict');
    expect((await brandsInDb()).map((b) => b.external_id)).toEqual(['1', '2']);
  });

  test('ganti nama ke nama merk lain -> invalid (CONFLICT server dipetakan ke field name)', async () => {
    await seedBrand(env, 'A', { syncRev: 1 });
    await seedBrand(env, 'B', { syncRev: 2 });
    const [out] = await results([{ uid: 'brand-a', name: 'B', baseRev: 1 }]);
    expect(out).toMatchObject({ status: 'invalid', fields: { name: 'Nama merk sudah dipakai' } });
  });

  test('batas jumlah entri dan bentuk payload', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `M${i}` }));
    expect(await push(many)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { brands: 'Maksimal 50 merk' } },
    });
    expect(await push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await call('sync.brands.push', { brands: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(
      await call('sync.brands.push', { brands: [{ name: 'A' }], overwrite: 'ya' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await call('sync.brands.push', null)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  test('field tidak dikenal ditolak per field', async () => {
    const [out] = await results([{ id: '1', name: 'Ubiquiti', nama: 'salah' }]);
    expect(out).toMatchObject({ status: 'invalid', fields: { nama: 'Field tidak dikenal' } });
  });

  test('kursor hasil impor tetap valid: sync_state diimpor apa adanya dan revisi baru melampauinya', async () => {
    await prime('brands', 40);
    await seedBrand(env, 'Lama', { syncRev: 40 });
    expect(await currentSyncRev(env.DB, 'brands')).toBe(40);
    const [created] = await results([{ name: 'Baru' }]);
    expect(created?.rev).toBe(41);
    // Desktop yang berkursor di 40 menarik hanya yang baru.
    const page = await call('sync.brands.pull', { sinceRev: 40 });
    expect(page.data.brands.map((b: { name: string }) => b.name)).toEqual(['Baru']);
    expect(page.data.nextRev).toBe(41);
  });
});

describe('files', () => {
  async function folderWithBridge(): Promise<string> {
    await env.DB.prepare(
      "INSERT INTO settings (`key`, value) VALUES ('DRIVE_FOLDER_ID', 'F1')",
    ).run();
    env.BRIDGE.state.folders.add('F1');
    return 'F1';
  }
  const driveFile = (folder: string, name: string, mime: string, base64: string) =>
    env.BRIDGE.createFile(folder, name, mime, base64);

  test('sync.file.get mengembalikan isi berkas di folder aplikasi', async () => {
    const folder = await folderWithBridge();
    const driveId = await driveFile(folder, 'a.png', 'image/png', PNG);
    expect(await call('sync.file.get', { driveId })).toEqual({
      ok: true,
      data: { driveId, mime: 'image/png', base64: PNG },
    });
  });

  test('GET /sync/files/{id}: byte mentah persis sama (semua nilai 0-255), Content-Type berkas, ETag = id, tanpa base64', async () => {
    const folder = await folderWithBridge();
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const driveId = await driveFile(
      folder,
      'semua.png',
      'image/png',
      Buffer.from(bytes).toString('base64'),
    );
    const response = await syncSend(env, 'sync.file.get', { driveId });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('etag')).toBe(`"${driveId}"`);
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    // JPEG dan WebP: Content-Type mengikuti berkas
    const jpeg = await driveFile(folder, 'b.jpg', 'image/jpeg', PNG);
    expect(
      (await syncSend(env, 'sync.file.get', { driveId: jpeg })).headers.get('content-type'),
    ).toBe('image/jpeg');
  });

  test('GET /sync/files/{id}: If-None-Match yang cocok = 304 tanpa badan; berbeda = 200', async () => {
    const folder = await folderWithBridge();
    const driveId = await driveFile(folder, 'a.png', 'image/png', PNG);
    const same = await syncSend(
      env,
      'sync.file.get',
      { driveId },
      {
        headers: { 'if-none-match': `"${driveId}"` },
      },
    );
    expect(same.status).toBe(304);
    expect(await same.text()).toBe('');
    expect(same.headers.get('etag')).toBe(`"${driveId}"`);
    const other = await syncSend(
      env,
      'sync.file.get',
      { driveId },
      {
        headers: { 'if-none-match': '"lain"' },
      },
    );
    expect(other.status).toBe(200);
    const odd = await syncSend(env, 'sync.file.get', { driveId: 'a/b c%d' });
    expect(odd.status).toBe(404);
    expect(await odd.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  test('id berkarakter khusus di jalur di-decode: berkas dengan id "a b" ditemukan (200), ETag memuat id asli', async () => {
    const folder = await folderWithBridge();
    env.BRIDGE.state.files.set('a b', {
      folderId: folder,
      name: 'spasi.png',
      mime: 'image/png',
      base64: PNG,
      shared: false,
      trashed: false,
    });
    const response = await syncSend(env, 'sync.file.get', { driveId: 'a b' });
    expect(response.status).toBe(200); // tanpa decoding, jalur "a%20b" tidak akan cocok dengan id "a b"
    expect(response.headers.get('etag')).toBe('"a b"');
    expect(response.headers.get('content-type')).toBe('image/png');
    const missing = await syncSend(env, 'sync.file.get', { driveId: 'a/b c%d' });
    expect(missing.status).toBe(404);
  });

  test('driveId 101 karakter ditolak 422 fields.driveId; 100 karakter diteruskan (404 bila tak ada)', async () => {
    await folderWithBridge();
    expect(await call('sync.file.get', { driveId: 'x'.repeat(101) })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', status: 422, fields: { driveId: expect.any(String) } },
    });
    expect(await call('sync.file.get', { driveId: 'x'.repeat(100) })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  test('Cache-Control berkas mengikuti def.download.cache pada tabel (bukan nilai tetap di kode)', async () => {
    const folder = await folderWithBridge();
    const driveId = await driveFile(folder, 'a.png', 'image/png', PNG);
    const download = SYNC_API_ROUTES['sync.file.get'].download as { cache?: string };
    const original = download.cache;
    const expected = (cache: string | undefined) =>
      cache === 'immutable' ? 'private, max-age=31536000, immutable' : 'private, no-cache';
    try {
      expect((await syncSend(env, 'sync.file.get', { driveId })).headers.get('cache-control')).toBe(
        expected(original),
      );
      download.cache = 'no-cache';
      const changed = await syncSend(env, 'sync.file.get', { driveId });
      expect(changed.headers.get('cache-control')).toBe('private, no-cache');
      expect(changed.status).toBe(200);
    } finally {
      download.cache = original;
    }
  });

  test('GET /sync/files/{id} tanpa token yang sah = 401 (berkas tidak pernah diperiksa)', async () => {
    const folder = await folderWithBridge();
    const driveId = await driveFile(folder, 'a.png', 'image/png', PNG);
    expect((await syncSend(env, 'sync.file.get', { driveId }, { token: 'salah' })).status).toBe(
      401,
    );
    expect((await syncSend(env, 'sync.file.get', { driveId }, { token: null })).status).toBe(401);
  });

  test('id di luar folder, tak dikenal, atau tanpa DRIVE_FOLDER_ID -> NOT_FOUND', async () => {
    const folder = await folderWithBridge();
    env.BRIDGE.state.folders.add('LAIN');
    const outside = await driveFile('LAIN', 'b.png', 'image/png', PNG);
    expect(await call('sync.file.get', { driveId: outside })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await call('sync.file.get', { driveId: 'tidak-ada' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const inside = await driveFile(folder, 'c.png', 'image/png', PNG);
    await env.DB.prepare("DELETE FROM settings WHERE `key` = 'DRIVE_FOLDER_ID'").run();
    expect(await call('sync.file.get', { driveId: inside })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  test('id kosong = rute tidak ada (404); berkas > 8 MB = 413 problem+json', async () => {
    const folder = await folderWithBridge();
    const empty = await app.request(
      'https://qc.test/api/v1/sync/files/',
      { headers: { authorization: `Bearer ${TOKEN}` } },
      env,
    );
    expect(empty.status).toBe(404);
    const big = await driveFile(folder, 'big.png', 'image/png', 'A'.repeat(11_000_000));
    expect(await call('sync.file.get', { driveId: big })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', status: 413, fields: { driveId: 'Berkas melebihi 8 MB' } },
    });
    // tepat di bawah batas lolos (8.000.000 byte = 10.666.668 karakter base64 dengan padding)
    const edge = await driveFile(folder, 'edge.png', 'image/png', 'A'.repeat(10_666_664));
    const ok = await syncSend(env, 'sync.file.get', { driveId: edge });
    expect(ok.status).toBe(200);
    expect((await ok.arrayBuffer()).byteLength).toBe(7_999_998);
  });

  test('probeDriveIds: 50 id baru diperiksa dengan konkurensi terbatas (<= 8, > 1), dedup tetap, hasil sama dengan berurutan', async () => {
    const folder = await folderWithBridge();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(await driveFile(folder, `f${i}.png`, 'image/png', PNG));
    }
    // sekuensial (acuan): satu per satu
    const expected = new Map<string, { mime: string; size: number } | null>();
    for (const id of ids) expected.set(id, await env.BRIDGE.fileInfo(id, folder));

    const real = env.BRIDGE.fileInfo.bind(env.BRIDGE);
    let active = 0;
    let peak = 0;
    let calls = 0;
    env.BRIDGE.fileInfo = async (fileId, folderId) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await real(fileId, folderId);
      } finally {
        active--;
      }
    };
    const probes = await probeDriveIds(env, [...ids, ...ids, 'tidak-ada']);
    expect(calls).toBe(51); // dedup: tiap id unik sekali
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(probes.size).toBe(51);
    for (const id of ids) expect(probes.get(id)).toEqual(expected.get(id) ?? null);
    expect(probes.get('tidak-ada')).toBeNull();
  });

  test('(N4) probeDriveIds: galat pertama menghentikan pekerja lain, tidak ada panggilan jembatan baru setelah penolakan', async () => {
    const folder = await folderWithBridge();
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) ids.push(await driveFile(folder, `g${i}.png`, 'image/png', PNG));
    const real = env.BRIDGE.fileInfo.bind(env.BRIDGE);
    let calls = 0;
    env.BRIDGE.fileInfo = async (fileId, folderId) => {
      calls++;
      const mine = calls;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (mine === 3) throw new Error('jembatan putus');
      return real(fileId, folderId);
    };
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(probeDriveIds(env, ids)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      const atRejection = calls;
      await new Promise((resolve) => setTimeout(resolve, 100)); // pekerja yang tersisa diberi waktu untuk (keliru) lanjut
      expect(calls).toBe(atRejection);
      expect(calls).toBeLessThanOrEqual(3 + 7); // paling banyak yang sedang berjalan saat galat (konkurensi 8)
    } finally {
      error.mockRestore();
    }
  });

  test('registerDriveFiles: berkas di folder didaftarkan sekali; id tak sah missing; idempoten', async () => {
    const folder = await folderWithBridge();
    env.BRIDGE.state.folders.add('LAIN');
    const good = await driveFile(folder, 'a.png', 'image/png', PNG);
    const outside = await driveFile('LAIN', 'b.png', 'image/png', PNG);
    const text = await driveFile(folder, 't.txt', 'text/plain', PNG);
    const ids = [good, outside, text, 'tidak-ada', good];
    const first = await registerDriveFiles(env, ids, await probeDriveIds(env, ids), 'owner-1');
    expect(first.missing.sort()).toEqual([outside, text, 'tidak-ada'].sort());
    expect(first.map.size).toBe(1);
    const rows = await env.DB.prepare(
      'SELECT drive_id, mime, size, owner_type, created_by, status FROM files',
    ).all();
    expect(rows.results).toEqual([
      {
        drive_id: good,
        mime: 'image/png',
        size: 16,
        owner_type: '',
        created_by: SYNC_ACTOR,
        status: 'active',
      },
    ]);
    const second = await registerDriveFiles(
      env,
      [good],
      await probeDriveIds(env, [good]),
      'owner-1',
    );
    expect(second.map.get(good)).toBe(first.map.get(good));
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first<{ n: number }>())?.n,
    ).toBe(1);
  });

  test('berkas yang sudah dimiliki entitas lain -> baris baru untuk berkas Drive yang sama', async () => {
    const folder = await folderWithBridge();
    const drive = await driveFile(folder, 'a.png', 'image/png', PNG);
    await registerDriveFiles(env, [drive], await probeDriveIds(env, [drive]), 'item-1');
    await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'item-1'").run();
    const plan = await planDriveFiles(env, [drive], await probeDriveIds(env, [drive]), 'item-2');
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]).toMatchObject({ driveId: drive, ownerType: '' });
    const again = await planDriveFiles(env, [drive], await probeDriveIds(env, [drive]), 'item-1');
    expect(again.pending).toHaveLength(0);
  });
});
