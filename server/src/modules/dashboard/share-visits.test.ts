// Data kunjungan tautan dashboard publik (keputusan pemilik 2026-11-24): kunjungan = halaman dibuka, dicatat oleh klien
// lewat `POST .../visit` (bukan oleh GET data, bukan oleh POST query).
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedSerial } from '@server-test/dashboard-seed';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { CreateShareInput } from '@shared/dashboard-share';
import { VISIT_LIMITS } from '@shared/dashboard-visit';
import { createShare, revokeShare } from './share-service';
import { drainVisitRecordings, listVisits, loadVisitSummary } from './share-visits';

setDefaultTimeout(180_000);

let env: TestEnv;
const NOW = Date.parse('2026-11-23T05:00:00.000Z');
const MINUTE = 60_000;
const SHARER = 'sharer@gmail.com';
const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU Ex' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-sharer',
    email: SHARER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
  await seedSerial(env, { id: 's1', buId: 'bu-x', itemId: 'i-1' });
});

function input(overrides: Partial<CreateShareInput> = {}): CreateShareInput {
  return {
    title: 'Ringkasan',
    filter: { from: '2026-11-01', to: '2026-11-23' },
    range: { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' },
    widgets: [{ id: 'sn.status', filters: {} }],
    offers: [],
    expiresInDays: 30,
    ...overrides,
  };
}

async function makeShare() {
  const user = await loadUserContext(env, SHARER);
  if (!user) throw new Error('pembagi tidak ditemukan');
  const dto = await createShare(env, user, input());
  return { id: dto.id, token: (dto.url ?? '').split('/dashboard-publik/')[1] ?? '', user };
}

interface Visitor {
  ip?: string;
  ua?: string | null;
  country?: string;
  trusted?: boolean;
}

/** `POST .../visit`; pencatatan berjalan di latar, jadi tes menunggu antreannya habis sebelum membaca hasil. */
async function visit(token: string, who: Visitor = {}, db = env.DB): Promise<Response> {
  const response = await rawVisit(token, who, db);
  await drainVisitRecordings();
  return response;
}

/** Seperti `visit` tetapi TANPA menunggu pencatatan latar (untuk menguji jalur respons). */
async function rawVisit(
  token: string,
  who: Visitor = {},
  db = env.DB,
  csrf = true,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (csrf) headers['x-requested-with'] = 'qc';
  const ua = who.ua === undefined ? CHROME_WIN : who.ua;
  if (ua !== null) headers['user-agent'] = ua;
  if (who.country !== undefined) headers['cf-ipcountry'] = who.country;
  return app.request(
    `https://qc.test/api/public/dashboards/${token}/visit`,
    { method: 'POST', headers },
    { ...env, DB: db, clientIp: who.ip ?? '203.0.113.77', trustedPeer: who.trusted ?? true },
  );
}

/** GET data halaman publik (tidak mencatat kunjungan). */
async function getData(token: string, ip = '203.0.113.77'): Promise<Response> {
  return app.request(
    `https://qc.test/api/public/dashboards/${token}`,
    { headers: { 'user-agent': CHROME_WIN } },
    { ...env, clientIp: ip, trustedPeer: true },
  );
}

async function rowsOf(id: string) {
  return {
    summary: await loadVisitSummary(env.DB, id),
    visits: await listVisits(env.DB, id),
  };
}

describe('pencatatan kunjungan', () => {
  test('visit sah dicatat: IP terpotong, negara, perangkat ringkas, dan ringkasan tautan', async () => {
    const { id, token } = await makeShare();
    const response = await visit(token, { country: 'id' });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    const { summary, visits } = await rowsOf(id);
    const iso = new Date(NOW).toISOString();
    expect(summary).toEqual({ visitCount: 1, firstVisitAt: iso, lastVisitAt: iso });
    expect(visits).toEqual([
      {
        visitedAt: iso,
        country: 'ID',
        device: 'Desktop · Chrome · Windows',
        ipPrefix: '203.0.113.0/24',
      },
    ]);
  });

  test('negara hanya dipercaya dari peer proxy tepercaya; nilai tak sah = kosong', async () => {
    const { id, token } = await makeShare();
    await visit(token, { country: 'US', trusted: false, ip: '198.51.100.1' });
    await visit(token, { country: 'IDN', trusted: true, ip: '198.51.101.1' });
    await visit(token, { country: 'sg', trusted: true, ip: '198.51.102.1' });
    const { visits } = await rowsOf(id);
    const byPrefix = Object.fromEntries(visits.map((row) => [row.ipPrefix, row.country]));
    expect(byPrefix).toEqual({
      '198.51.100.0/24': '',
      '198.51.101.0/24': '',
      '198.51.102.0/24': 'SG',
    });
  });

  test('IPv6 dipotong /48; IP tak dikenal menghasilkan awalan kosong; tanpa User-Agent perangkat kosong', async () => {
    const { id, token } = await makeShare();
    await visit(token, { ip: '2001:db8:abcd:12:ffff:eeee:dddd:1' });
    await visit(token, { ip: 'unknown', ua: null });
    const { visits } = await rowsOf(id);
    expect(visits.map((row) => row.ipPrefix).sort()).toEqual(['', '2001:db8:abcd::/48']);
    expect(visits.find((row) => row.ipPrefix === '')?.device).toBe('');
  });

  test('IP asli dan User-Agent mentah tidak ada di tabel manapun yang ditulis', async () => {
    const { id, token } = await makeShare();
    await visit(token, { ip: '203.0.113.77' });
    await visit(token, { ip: '2001:db8:abcd:12:ffff:eeee:dddd:1', ua: FIREFOX_LINUX });
    const dump = JSON.stringify([
      (await env.DB.prepare('SELECT * FROM dashboard_share_visits').all()).results,
      (await env.DB.prepare('SELECT * FROM dashboard_shares').all()).results,
      (await env.DB.prepare('SELECT * FROM audit_log').all()).results,
    ]);
    // `rate_limits` sengaja tak diperiksa: penghitung pembatas laju sementara (dibuang penjadwal) memuat alamat pembatas
    // pada kuncinya, sama dengan pembatas query dan kegagalan; yang dijaga di sini adalah data kunjungan yang tersimpan.
    expect(dump).not.toContain('203.0.113.77');
    expect(dump).not.toContain('dddd:1');
    expect(dump).not.toContain('Mozilla');
    expect(dump).not.toContain('537.36');
    expect(id).toBeTruthy();
  });
});

describe('dedup 30 menit', () => {
  test('muat ulang dari IP terpotong dan perangkat yang sama dihitung satu; tidak ada yang ditulis', async () => {
    const { id, token } = await makeShare();
    await visit(token, { ip: '203.0.113.5' });
    env.clock.set(NOW + 10 * MINUTE);
    await visit(token, { ip: '203.0.113.200' }); // /24 sama, perangkat sama
    const { summary, visits } = await rowsOf(id);
    expect(summary.visitCount).toBe(1);
    expect(visits).toHaveLength(1);
    expect(summary.firstVisitAt).toBe(new Date(NOW).toISOString());
    // last_visit_at = awal kunjungan terakhir yang DIHITUNG; muat ulang dalam jendela dedup tidak menulis apa pun.
    expect(summary.lastVisitAt).toBe(new Date(NOW).toISOString());
    expect(visits[0]?.visitedAt).toBe(new Date(NOW).toISOString());
  });

  test('muat ulang dalam jendela dedup tidak menjalankan batch tulis (pemeriksaan awal tanpa kunci)', async () => {
    const { token } = await makeShare();
    let batches = 0;
    const counting = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return (...args: Parameters<typeof env.DB.batch>) => {
            batches += 1;
            return target.batch(...args);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await visit(token, { ip: '203.0.113.5' }, counting);
    expect(batches).toBe(1);
    for (let index = 0; index < 5; index += 1) {
      env.clock.set(NOW + (index + 1) * MINUTE);
      await visit(token, { ip: '203.0.113.5' }, counting);
    }
    expect(batches).toBe(1);
    env.clock.set(NOW + VISIT_LIMITS.dedupMs);
    await visit(token, { ip: '203.0.113.5' }, counting);
    expect(batches).toBe(2);
  });

  test('lewat 30 menit sejak baris kunjungan terakhir = kunjungan baru', async () => {
    const { id, token } = await makeShare();
    await visit(token);
    env.clock.set(NOW + VISIT_LIMITS.dedupMs - 1);
    await visit(token); // masih dalam jendela
    expect((await rowsOf(id)).summary.visitCount).toBe(1);
    env.clock.set(NOW + VISIT_LIMITS.dedupMs);
    await visit(token); // tepat 30 menit: kunjungan baru
    const { summary, visits } = await rowsOf(id);
    expect(summary.visitCount).toBe(2);
    expect(visits).toHaveLength(2);
  });

  test('perangkat atau jaringan berbeda = kunjungan berbeda', async () => {
    const { id, token } = await makeShare();
    await visit(token, { ip: '203.0.113.5', ua: CHROME_WIN });
    await visit(token, { ip: '203.0.113.5', ua: FIREFOX_LINUX });
    await visit(token, { ip: '203.0.114.5', ua: CHROME_WIN });
    expect((await rowsOf(id)).summary.visitCount).toBe(3);
  });

  test('tautan lain tidak mempengaruhi dedup', async () => {
    const first = await makeShare();
    const second = await makeShare();
    await visit(first.token);
    await visit(second.token);
    expect((await rowsOf(first.id)).summary.visitCount).toBe(1);
    expect((await rowsOf(second.id)).summary.visitCount).toBe(1);
  });
});

describe('yang tidak dihitung kunjungan', () => {
  test('GET data halaman dan POST query tidak mencatat kunjungan', async () => {
    const { id, token } = await makeShare();
    for (let index = 0; index < 3; index += 1) expect((await getData(token)).status).toBe(200);
    const post = await app.request(
      `https://qc.test/api/public/dashboards/${token}/query`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'qc' },
        body: '{}',
      },
      { ...env, clientIp: '203.0.113.9', trustedPeer: true },
    );
    expect(post.status).toBe(200);
    await drainVisitRecordings();
    const { summary, visits } = await rowsOf(id);
    expect(summary).toEqual({ visitCount: 0, firstVisitAt: '', lastVisitAt: '' });
    expect(visits).toEqual([]);
  });

  test('visit dengan token rusak, dicabut, atau kedaluwarsa = 404 seragam tanpa menulis', async () => {
    const { id, token, user } = await makeShare();
    const bad = await visit('v1.x.1.salah');
    expect(bad.status).toBe(404);
    const strip = (text: string) =>
      JSON.stringify(Object.assign(JSON.parse(text), { requestId: '' }));
    const badBody = strip(await bad.text());
    env.clock.set(NOW + 31 * 86_400_000);
    const expired = await visit(token);
    expect(expired.status).toBe(404);
    env.clock.set(NOW);
    await revokeShare(env, user, id);
    const revoked = await visit(token);
    expect(revoked.status).toBe(404);
    // Jawaban penolakan tak membedakan sebabnya.
    expect(strip(await expired.text())).toBe(badBody);
    expect(strip(await revoked.text())).toBe(badBody);
    const { summary, visits } = await rowsOf(id);
    expect(summary).toEqual({ visitCount: 0, firstVisitAt: '', lastVisitAt: '' });
    expect(visits).toEqual([]);
  });

  test('visit saat pembagi sudah terhapus = 404 seragam tanpa menulis', async () => {
    const { id, token } = await makeShare();
    await env.DB.prepare("UPDATE users SET deleted_at = ?, deleted_by = 'x' WHERE email = ?")
      .bind(new Date(NOW).toISOString(), SHARER)
      .run();
    expect((await visit(token)).status).toBe(404);
    expect((await rowsOf(id)).summary.visitCount).toBe(0);
  });

  test('visit tanpa header X-Requested-With ditolak seperti POST lain dan tidak mencatat', async () => {
    const { id, token } = await makeShare();
    const response = await rawVisit(token, {}, env.DB, false);
    expect(response.status).toBe(403);
    await drainVisitRecordings();
    expect((await rowsOf(id)).summary.visitCount).toBe(0);
  });
});

describe('pembatas laju visit (angka sama dengan POST query: 30 per menit per IP, 120 per menit per tautan)', () => {
  test('melewati batas per IP = 429 tanpa mencatat; jendela baru membebaskan lagi', async () => {
    const { id, token } = await makeShare();
    await env.DB.prepare('INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 30, ?)')
      .bind('dashboard-visit-ip:203.0.113.77', NOW)
      .run();
    const limited = await visit(token, { ip: '203.0.113.77' });
    expect(limited.status).toBe(429);
    expect((await rowsOf(id)).summary.visitCount).toBe(0);
    env.clock.set(NOW + 61_000); // jendela satu menit lewat
    expect((await visit(token, { ip: '203.0.113.77' })).status).toBe(204);
    expect((await rowsOf(id)).summary.visitCount).toBe(1);
  });

  test('melewati batas per tautan = 429 walau dari IP lain', async () => {
    const { id, token } = await makeShare();
    await env.DB.prepare('INSERT INTO rate_limits (`key`, count, window_start) VALUES (?, 120, ?)')
      .bind(`dashboard-visit-token:${id}`, NOW)
      .run();
    expect((await visit(token, { ip: '198.51.100.5' })).status).toBe(429);
    expect((await rowsOf(id)).summary.visitCount).toBe(0);
  });

  test('visit tidak memakan jatah POST query', async () => {
    const { token } = await makeShare();
    await visit(token);
    const rows = await env.DB.prepare(
      "SELECT `key` FROM rate_limits WHERE `key` LIKE 'dashboard-view-%'",
    ).all<{ key: string }>();
    expect(rows.results).toEqual([]);
  });
});

describe('retensi dan konkurensi', () => {
  test('menyimpan 50 baris terbaru; visit_count menghitung semuanya', async () => {
    const { id, token } = await makeShare();
    for (let index = 0; index < 55; index += 1) {
      env.clock.set(NOW + index * MINUTE);
      await visit(token, { ip: `198.51.${index}.1`, ua: null });
    }
    const { summary, visits } = await rowsOf(id);
    expect(summary.visitCount).toBe(55);
    expect(visits).toHaveLength(VISIT_LIMITS.keep);
    expect(visits[0]?.ipPrefix).toBe('198.51.54.0/24'); // terbaru di atas
    expect(visits.at(-1)?.ipPrefix).toBe('198.51.5.0/24'); // 5 terlama terbuang
    const stored = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM dashboard_share_visits WHERE share_id = ?',
    )
      .bind(id)
      .first<{ n: number | string }>();
    expect(Number(stored?.n)).toBe(VISIT_LIMITS.keep);
  });

  test('pemangkasan satu tautan tidak menyentuh baris tautan lain', async () => {
    const first = await makeShare();
    const second = await makeShare();
    await visit(second.token, { ip: '192.0.2.1' });
    for (let index = 0; index < 52; index += 1) {
      env.clock.set(NOW + index * MINUTE);
      await visit(first.token, { ip: `198.51.${index}.1`, ua: null });
    }
    expect((await rowsOf(second.id)).visits).toHaveLength(1);
    expect((await rowsOf(first.id)).visits).toHaveLength(VISIT_LIMITS.keep);
  });

  test('visit serentak dari IP berbeda: visit_count tepat sejumlah kunjungan', async () => {
    const { id, token } = await makeShare();
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) => visit(token, { ip: `198.51.${index}.1` })),
    );
    expect(responses.every((response) => response.status === 204)).toBe(true);
    const { summary, visits } = await rowsOf(id);
    expect(summary.visitCount).toBe(12);
    expect(visits).toHaveLength(12);
  });

  test('visit serentak dari IP dan perangkat yang sama dihitung satu kunjungan', async () => {
    const { id, token } = await makeShare();
    await Promise.all(Array.from({ length: 8 }, () => visit(token, { ip: '203.0.113.5' })));
    const { summary, visits } = await rowsOf(id);
    expect(summary.visitCount).toBe(1);
    expect(visits).toHaveLength(1);
  });
});

describe('penyegaran dan pencatatan latar', () => {
  test('penyegaran halaman (POST query kosong) berulang tidak mencatat dan tidak menggeser last_visit_at', async () => {
    const { id, token } = await makeShare();
    await visit(token, { ip: '203.0.113.5' });
    for (let index = 1; index <= 5; index += 1) {
      env.clock.set(NOW + index * VISIT_LIMITS.dedupMs); // tiap kali di luar jendela dedup
      const post = await app.request(
        `https://qc.test/api/public/dashboards/${token}/query`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-requested-with': 'qc',
            'user-agent': CHROME_WIN,
          },
          body: '{}',
        },
        { ...env, clientIp: '203.0.113.5', trustedPeer: true },
      );
      expect(post.status).toBe(200);
    }
    await drainVisitRecordings();
    const { summary, visits } = await rowsOf(id);
    expect(summary).toEqual({
      visitCount: 1,
      firstVisitAt: new Date(NOW).toISOString(),
      lastVisitAt: new Date(NOW).toISOString(),
    });
    expect(visits).toHaveLength(1);
  });

  test('respons tidak menunggu pencatatan yang lambat; hasilnya tetap tercatat sesudahnya', async () => {
    const { id, token } = await makeShare();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    const slow = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (...args: Parameters<typeof env.DB.batch>) => {
            await gate;
            const out = await target.batch(...args);
            finished = true;
            return out;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await rawVisit(token, {}, slow);
    expect(response.status).toBe(204);
    expect(finished).toBe(false); // jawaban sudah kembali selagi pencatatan masih tertahan
    release();
    await drainVisitRecordings();
    expect(finished).toBe(true);
    expect((await rowsOf(id)).summary.visitCount).toBe(1);
  });

  test('visit serentak (Promise.all, tanpa menunggu antrean) dari IP dan perangkat sama = satu kunjungan', async () => {
    const { id, token } = await makeShare();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => rawVisit(token, { ip: '203.0.113.5' })),
    );
    expect(responses.every((response) => response.status === 204)).toBe(true);
    await drainVisitRecordings();
    const { summary, visits } = await rowsOf(id);
    expect(summary.visitCount).toBe(1);
    expect(visits).toHaveLength(1);
  });
});

describe('kegagalan pencatatan', () => {
  test('galat saat mencatat tidak menggagalkan halaman publik dan tidak mencatat token/IP di log', async () => {
    const { id, token } = await makeShare();
    const broken = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async () => {
            throw new Error(`gagal ${token} 203.0.113.77`);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const response = await visit(token, {}, broken);
      expect(response.status).toBe(204);
    } finally {
      console.error = original;
    }
    expect(JSON.stringify(logged)).not.toContain(token);
    expect(JSON.stringify(logged)).not.toContain('203.0.113.77');
    expect(logged.length).toBeGreaterThan(0);
    expect((await rowsOf(id)).summary.visitCount).toBe(0);
  });
});
