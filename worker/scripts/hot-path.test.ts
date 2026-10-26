import { beforeAll, describe, expect, test } from 'bun:test';
import { d1StatsOf } from '@worker-test/sqlite-d1';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { resetMemCache } from '../src/core/mem-cache';
import { signSessionToken } from '../src/core/session';
import { app } from '../src/index';
import { buildCases, type LoadCase } from './load-cpu-cases';
import { buildLoadSql } from './load-cpu-lib';

/**
 * Pagar jalur panas (Task 4.5): CPU di edge tidak dapat diukur lokal, jadi dua penyebab utamanya dijaga di
 * sini: (1) round trip D1 per rute (tiap round trip ±0,5-0,8 ms CPU di edge) dengan cache memori isolate
 * hangat, dan (2) rencana kueri: tidak ada pemindaian penuh tabel besar di rute panas (rows read D1 dihitung
 * dari baris yang DIPINDAI; kuota 5 juta/hari).
 */

const NOW = Date.parse('2026-10-25T05:00:00.000Z');
const SYNC_TOKEN = 't'.repeat(48);

let env: TestEnv;
let headers: Record<string, string>;
let cases: Map<string, LoadCase>;

beforeAll(async () => {
  env = await createTestEnv({ SYNC_API_TOKEN: SYNC_TOKEN, CACHE_TTL_MS: '10000' });
  env.clock.set(NOW);
  await env.DB.exec(buildLoadSql('loadtest@staging.test', NOW));
  const token = await signSessionToken(env, 'loadtest@staging.test', NOW);
  headers = {
    cookie: `qc_session=${token}`,
    'x-requested-with': 'qc',
    'content-type': 'application/json',
  };
  cases = new Map(buildCases({ nowMs: NOW, syncToken: SYNC_TOKEN }).map((c) => [c.name, c]));
});

async function call(name: string, i: number): Promise<void> {
  const loadCase = cases.get(name);
  if (!loadCase) throw new Error(`kasus ${name} tidak ada`);
  const r = loadCase.request(i);
  const response = await app.request(
    `https://x${r.path}`,
    {
      method: r.method,
      headers: r.auth === 'cookie' ? headers : { 'content-type': 'application/json' },
      ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
    },
    env,
  );
  const body = (await response.json()) as { ok?: boolean; error?: unknown };
  if (body.ok !== true) throw new Error(`${name}: ${JSON.stringify(body)}`);
}

/** Round trip D1 per panggilan setelah satu panggilan pemanasan (cache isolate hangat). */
async function tripsPer(name: string, calls = 3): Promise<number> {
  await call(name, 0);
  const stats = d1StatsOf(env.DB);
  const before = stats.trips;
  for (let i = 1; i <= calls; i++) await call(name, i);
  return (stats.trips - before) / calls;
}

describe('round trip D1 per rute (cache hangat)', () => {
  const budget: Array<[string, number]> = [
    ['auth.me', 0],
    ['brands.list', 0],
    ['customers.list', 0],
    ['handovers.options', 0],
    ['items.list', 1],
    ['items.get', 1],
    ['handovers.get', 1],
    ['handovers.board:new', 1],
    ['handovers.board:in_progress', 1],
    ['handovers.board:done', 1],
    ['handovers.board:cancelled', 1],
    ['handovers.setCheck', 2],
    ['handovers.setDone', 2],
    ['handovers.comment:general', 2],
    ['handovers.comment:anchored', 2],
    ['handovers.cancel', 2],
    ['handovers.reopen', 2],
    ['handovers.save:update', 3],
    ['handovers.save:create', 2],
    ['handovers.saveBatch:10x5000', 3],
    // Satu kueri kabel (autentikasi sinkron = 1 round trip lain); berkas hanya bila detail memuat rujukan qcfile:.
    ['sync.items.pull:500', 2],
    ['sync.items.pull:50+detail', 2],
    ['items.setStatus', 2],
    ['items.save', 2],
    ['brands.save:rename(~50 item)', 4],
  ];
  for (const [name, max] of budget) {
    test(`${name} <= ${max}`, async () => {
      expect(await tripsPer(name)).toBeLessThanOrEqual(max);
    });
  }

  test('sync.items.push: <= 3 round trip per entri (5 entri)', async () => {
    expect(await tripsPer('sync.items.push:5+detail', 2)).toBeLessThanOrEqual(5 * 3 + 4);
  });
});

async function planOf(sql: string): Promise<string[]> {
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>();
  return plan.results.map((row) => row.detail);
}

/**
 * Pemindaian yang SENGAJA ada per rute (tabel kecil seluruhnya, atau urutan indeks yang dibatasi LIMIT). Selain
 * ini, setiap `SCAN` di rencana kueri rute panas menggagalkan tes: itu pemindaian penuh yang menghabiskan
 * rows read D1 (kuota 5 juta/hari).
 */
const ALLOWED_SCANS: Record<string, string[]> = {
  'items.list': ['SCAN i USING INDEX items_key'],
  'access.audit.list': ['SCAN audit_log USING INDEX audit_log_ts'],
  'access.audit.list:cursor': ['SCAN audit_log USING INDEX audit_log_ts'],
};

/**
 * Tabel kecil (puluhan/ratusan baris) yang memang dibaca seluruhnya SAAT cache memori isolate kosong; cache
 * (TTL <= 15 dtk) melindungi dari pembacaan tiap permintaan, dan jumlah barisnya terbatas.
 */
/**
 * `json_each` atas larik kecil milik item itu sendiri (maks. 10 gambar, 30 stiker/kelengkapan), bukan tabel:
 * diizinkan hanya pada rute tarik sinkron yang menyusun JSON kabel di SQL.
 */
const JSON_EACH_SCAN = /^SCAN (?:\(subquery-\d+\)|\w+ VIRTUAL TABLE INDEX \d+:)/;
const JSON_EACH_ROUTES = new Set(['sync.items.pull:500', 'sync.items.pull:50+detail']);
/**
 * Rute board: kueri luar membaca halaman yang sudah dibatasi `LIMIT` (`SCAN p`, paling banyak limit+1 baris)
 * untuk memasang subkueri komentar; tabel sumbernya tetap dibaca lewat indeks.
 */
const PAGE_SUBQUERY_SCAN = /^SCAN (?:p|\(subquery-\d+\))$/;
const SMALL_TABLE_SCAN = /^SCAN (brands|locations|roles|customers)(?: |$)/;

describe('rencana kueri: tanpa pemindaian penuh tabel besar', () => {
  const routes = [
    'items.save',
    'items.setStatus',
    'brands.save:rename(~50 item)',
    'handovers.board:new',
    'handovers.board:in_progress',
    'handovers.board:done',
    'handovers.board:cancelled',
    'handovers.get',
    'handovers.setCheck',
    'handovers.comment:anchored',
    'handovers.save:create',
    'handovers.saveBatch:10x5000',
    'sync.items.push:5+detail',
    'sync.items.pull:500',
    'sync.items.pull:50+detail',
    'items.list',
    'items.list:cursor',
    'access.audit.list',
    'access.audit.list:cursor',
    'brands.list',
    'handovers.options',
  ];
  for (const name of routes) {
    test(name, async () => {
      const stats = d1StatsOf(env.DB);
      // Cache kosong pada panggilan pemanasan; `brands.list`/`options` hanya membaca tabel saat cache kosong.
      resetMemCache();
      stats.log = [];
      await call(name, 0);
      await call(name, 1);
      const executed = [...new Set(stats.log)];
      stats.log = null;
      expect(executed.length).toBeGreaterThan(0);
      const scans = new Set<string>();
      // EXPLAIN pada UPDATE/DELETE tidak dijalankan: PK/UNIQUE/indeks sudah dicakup tes perilaku.
      for (const sql of executed.filter((entry) => /^\s*(SELECT|WITH)\b/i.test(entry))) {
        for (const detail of await planOf(sql)) {
          if (SMALL_TABLE_SCAN.test(detail) || detail === 'SCAN CONSTANT ROW') continue;
          if (JSON_EACH_ROUTES.has(name) && JSON_EACH_SCAN.test(detail)) continue;
          if (name.startsWith('handovers.board:') && PAGE_SUBQUERY_SCAN.test(detail)) continue;
          if (detail.startsWith('SCAN ')) scans.add(detail);
        }
      }
      expect([...scans].sort()).toEqual([...(ALLOWED_SCANS[name] ?? [])].sort());
    });
  }

  test('pencarian daftar item berdasarkan teks (instr) memang memindai: dikecualikan dari rute panas', async () => {
    const plan = await planOf(
      'SELECT i.id FROM items i WHERE (instr(i.key, ?) > 0 OR instr(i.alias_keys, ?) > 0) ORDER BY i.key LIMIT 51',
    );
    expect(plan.some((detail) => /SCAN i USING INDEX items_key/.test(detail))).toBe(true);
  });
});
