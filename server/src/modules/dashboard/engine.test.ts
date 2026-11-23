import { beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { WidgetData, WidgetId } from '@shared/dashboard';
import { createTtlCache } from './cache';
import { runWidgets, WIDGET_CONCURRENCY } from './engine';
import { createLimiter } from './limiter';
import type { WidgetCtx, WidgetImpl } from './registry';
import { resolveScope } from './scope';

setDefaultTimeout(60_000);

let env: TestEnv;

const NOW = Date.UTC(2026, 10, 23, 5, 0, 0);
const IDS: WidgetId[] = [
  'hs.created',
  'hs.active',
  'hs.status',
  'hs.trend',
  'hs.byLocation',
  'hs.byCustomer',
  'hs.avgDuration',
  'sn.recorded',
  'sn.status',
];

const scope = resolveScope(
  {
    email: 'u@gmail.com',
    name: 'U',
    userId: 'u1',
    isSuperAdmin: false,
    permissions: {} as never,
    locations: {},
    businessUnits: {},
    sharedAccount: false,
    deletedBuIds: [],
  },
  { from: '2026-11-17', to: '2026-11-23' },
  NOW,
);

function impls(
  run: (id: WidgetId, ctx: WidgetCtx) => Promise<WidgetData>,
): Map<WidgetId, WidgetImpl> {
  return new Map(IDS.map((id) => [id, { id, run: (ctx: WidgetCtx) => run(id, ctx) }]));
}

const ok = (value = 1): WidgetData => ({ kind: 'number', value });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
});

describe('runWidgets', () => {
  test('semafor per proses: paling banyak 6 widget bersamaan, juga lintas permintaan serentak', async () => {
    expect(WIDGET_CONCURRENCY).toBe(6);
    let running = 0;
    let peak = 0;
    const map = impls(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(15);
      running -= 1;
      return ok();
    });
    // Tiga permintaan serentak (mis. tiga grup/tab), tiap permintaan 9 widget dengan cakupan berbeda (tanpa cache).
    const calls = [0, 1, 2].map((index) =>
      runWidgets(
        env,
        { ...scope, buIds: [`bu${index}`] },
        IDS.map((id) => ({ id })),
        map,
      ),
    );
    const all = await Promise.all(calls);
    expect(all.every((results) => results.every((result) => result.status === 'ok'))).toBe(true);
    expect(peak).toBe(6);
  });

  test('widget dijalankan menurut urutan permintaan (FIFO) saat antre', async () => {
    const started: WidgetId[] = [];
    let running = 0;
    let peak = 0;
    const map = impls(async (id) => {
      started.push(id);
      running += 1;
      peak = Math.max(peak, running);
      await sleep(3);
      running -= 1;
      return ok();
    });
    await runWidgets(
      env,
      scope,
      IDS.map((id) => ({ id })),
      map,
      { limiter: createLimiter(2) },
    );
    expect(started).toEqual(IDS);
    expect(peak).toBe(2);
  });

  test('batas waktu dihitung setelah slot diperoleh: yang menunggu antrean tidak menjadi galat palsu', async () => {
    const map = impls(async () => {
      await sleep(30);
      return ok();
    });
    // Slot 1: widget kedua menunggu 30 ms lalu berjalan 30 ms (total 60 ms) dengan batas 50 ms per widget.
    const results = await runWidgets(env, scope, [{ id: 'hs.created' }, { id: 'hs.active' }], map, {
      timeoutMs: 50,
      limiter: createLimiter(1),
    });
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok']);
  });

  test('slot dilepas saat widget timeout atau gagal: widget berikutnya tetap berjalan', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const limiter = createLimiter(1);
      const started = Date.now();
      const map = impls(async (id) => {
        if (id === 'hs.created') await sleep(400);
        if (id === 'hs.active') throw new Error('boom');
        return ok();
      });
      const results = await runWidgets(
        env,
        scope,
        [{ id: 'hs.created' }, { id: 'hs.active' }, { id: 'hs.status' }],
        map,
        { timeoutMs: 40, limiter },
      );
      expect(results.map((result) => result.status)).toEqual(['error', 'error', 'ok']);
      // Selesai jauh sebelum widget lambat (400 ms) selesai: slotnya dilepas saat timeout, bukan saat kerja usai.
      expect(Date.now() - started).toBeLessThan(300);
      expect(limiter.active).toBe(0);
      expect(limiter.waiting).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  test('hasil mengikuti urutan permintaan', async () => {
    const map = impls(async (id) => ok(IDS.indexOf(id)));
    const results = await runWidgets(env, scope, [{ id: 'sn.status' }, { id: 'hs.created' }], map);
    expect(results.map((result) => result.id)).toEqual(['sn.status', 'hs.created']);
  });

  test('satu widget melempar: error generik, widget lain tetap ok dan tanpa bocor pesan', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const map = impls(async (id) => {
        if (id === 'hs.active') throw new Error("SQL rahasia: Unknown column 'x' ... nilai 123");
        return ok();
      });
      const results = await runWidgets(
        env,
        scope,
        [{ id: 'hs.created' }, { id: 'hs.active' }, { id: 'hs.status' }],
        map,
      );
      expect(results[0]?.status).toBe('ok');
      expect(results[2]?.status).toBe('ok');
      expect(results[1]).toEqual({
        id: 'hs.active',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
      expect(JSON.stringify(results)).not.toContain('rahasia');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('widget melebihi batas waktu menjadi error, yang lain ok', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const map = impls(async (id) => {
        if (id === 'hs.active') await sleep(500);
        return ok();
      });
      const results = await runWidgets(
        env,
        scope,
        [{ id: 'hs.created' }, { id: 'hs.active' }],
        map,
        { timeoutMs: 40 },
      );
      expect(results[0]?.status).toBe('ok');
      expect(results[1]).toEqual({
        id: 'hs.active',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('id tanpa implementasi menjadi error generik', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const results = await runWidgets(env, scope, [{ id: 'pt.condition' }], new Map());
      expect(results[0]).toEqual({
        id: 'pt.condition',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('widget menerima filter dan cakupan yang sama', async () => {
    let seen: WidgetCtx | null = null;
    const map = impls(async (_id, ctx) => {
      seen = ctx;
      return ok();
    });
    await runWidgets(env, scope, [{ id: 'hs.created', filters: { status: ['done'] } }], map);
    expect((seen as WidgetCtx | null)?.filters).toEqual({ status: ['done'] });
    expect((seen as WidgetCtx | null)?.scope).toBe(scope);
  });

  test('cache 30 dtk: permintaan sama tidak dijalankan ulang, setelah 31 dtk dijalankan ulang', async () => {
    let calls = 0;
    const map = impls(async () => {
      calls += 1;
      return ok(calls);
    });
    const request = [{ id: 'hs.created' as const, filters: { status: ['done', 'new'] } }];
    const first = await runWidgets(env, scope, request, map);
    expect(calls).toBe(1);
    env.clock.advance(29_000);
    const second = await runWidgets(env, scope, request, map);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    // Urutan nilai filter tidak mengubah kunci cache.
    await runWidgets(env, scope, [{ id: 'hs.created', filters: { status: ['new', 'done'] } }], map);
    expect(calls).toBe(1);
    env.clock.advance(2_000);
    const third = await runWidgets(env, scope, request, map);
    expect(calls).toBe(2);
    expect(third).not.toEqual(first);
  });

  test('filter berbeda atau cakupan berbeda tidak berbagi cache; galat tidak di-cache', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      let calls = 0;
      let fail = true;
      const map = impls(async () => {
        calls += 1;
        if (fail) throw new Error('boom');
        return ok();
      });
      const request = [{ id: 'hs.created' as const }];
      await runWidgets(env, scope, request, map);
      fail = false;
      const results = await runWidgets(env, scope, request, map);
      expect(results[0]?.status).toBe('ok');
      expect(calls).toBe(2);
      await runWidgets(env, scope, [{ id: 'hs.created', filters: { status: ['done'] } }], map);
      expect(calls).toBe(3);
      await runWidgets(env, { ...scope, buIds: ['lain'] }, request, map);
      expect(calls).toBe(4);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createTtlCache', () => {
  test('kedaluwarsa menurut jam yang disuntik dan membuang entri lama saat penuh', () => {
    let now = 0;
    const cache = createTtlCache<number>(1000, () => now, 2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    now = 999;
    expect(cache.get('a')).toBe(1);
    now = 1001;
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.size()).toBeLessThanOrEqual(2);
    expect(cache.get('d')).toBe(4);
  });
});
