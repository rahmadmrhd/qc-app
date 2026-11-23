import { type Env, nowOf } from '@server/core/env';
import type { DashboardWidgetRequest, WidgetData, WidgetResult } from '@shared/dashboard';
import { createTtlCache, type TtlCache } from './cache';
import { createLimiter, type Limiter } from './limiter';
import { WIDGET_IMPLS, type WidgetImpl } from './registry';
import type { ResolvedScope } from './scope';

/** Batas atas widget berjalan bersamaan per proses. */
export const WIDGET_CONCURRENCY = 6;
/** Koneksi pool yang selalu disisakan untuk rute lain (login, Serah Terima, antrean offline). */
const POOL_RESERVE = 4;
/** Ukuran pool bila tak diketahui (bawaan `createDb`). */
const DEFAULT_POOL_SIZE = 10;

/**
 * Batas widget bersamaan untuk pool berukuran `poolSize`: `min(6, max(1, pool - 4))`, jadi dashboard tak pernah
 * mengambil seluruh pool walau `DB_POOL_SIZE` diatur kecil (pool 10 = 6, pool 8 = 4, pool <= 5 = 1).
 */
export function widgetConcurrencyFor(poolSize: number | undefined): number {
  const pool = poolSize ?? DEFAULT_POOL_SIZE;
  return Math.min(WIDGET_CONCURRENCY, Math.max(1, pool - POOL_RESERVE));
}
export const WIDGET_TIMEOUT_MS = 15_000;
export const WIDGET_CACHE_TTL_MS = 30_000;
const GENERIC_ERROR = 'Widget tidak dapat dimuat';

/** Cache per `Env` (satu per proses di produksi): kunci tidak memuat identitas basis data, jadi tak boleh dibagi antar env. */
const caches = new WeakMap<Env, TtlCache<WidgetData>>();

function cacheOf(env: Env): TtlCache<WidgetData> {
  let cache = caches.get(env);
  if (!cache) {
    cache = createTtlCache<WidgetData>(WIDGET_CACHE_TTL_MS, () => nowOf(env));
    caches.set(env, cache);
  }
  return cache;
}

/** Kunci cache: widget + cakupan terselesaikan + filter grup (kunci dan nilai diurutkan agar urutan tak berpengaruh). */
function cacheKey(request: DashboardWidgetRequest, scope: ResolvedScope): string {
  const filters = Object.entries(request.filters ?? {})
    .map(([key, values]) => [key, [...values].sort()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([request.id, scope, filters]);
}

/**
 * Satu semafor per pool basis data (satu per proses di produksi), dibagi SEMUA permintaan dashboard (dan kelak laporan
 * terjadwal): beban dibatasi per proses, bukan per permintaan. Kunci = `env.DB` karena kolam koneksilah yang langka.
 */
const limiters = new WeakMap<object, Limiter>();

export function widgetLimiterOf(env: Env): Limiter {
  let limiter = limiters.get(env.DB);
  if (!limiter) {
    limiter = createLimiter(widgetConcurrencyFor(env.DB.poolSize));
    limiters.set(env.DB, limiter);
  }
  return limiter;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Widget melebihi batas waktu ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Menjalankan widget yang diminta: semuanya antre di semafor per proses (`WIDGET_CONCURRENCY` bersamaan, FIFO menurut
 * urutan permintaan), batas waktu per widget dihitung SETELAH slot diperoleh (menunggu antrean bukan galat), hasil
 * `ok` di-cache 30 detik (cache dicek sebelum antre, jadi tak memakai slot). Slot dilepas saat widget selesai, gagal,
 * atau melewati batas waktu; kueri yang ditinggalkan karena batas waktu tak dapat dibatalkan dan masih menahan satu
 * koneksi sampai selesai. Satu widget yang gagal atau lambat menjadi `error` generik (galat asli hanya ke
 * `console.error`) tanpa menjatuhkan yang lain. TIDAK memeriksa izin: pemanggil menyaring dengan `allowedWidgetIds`.
 */
export async function runWidgets(
  env: Env,
  scope: ResolvedScope,
  requests: readonly DashboardWidgetRequest[],
  impls: ReadonlyMap<DashboardWidgetRequest['id'], WidgetImpl> = WIDGET_IMPLS,
  options: { timeoutMs?: number; limiter?: Limiter } = {},
): Promise<WidgetResult[]> {
  const cache = cacheOf(env);
  const timeoutMs = options.timeoutMs ?? WIDGET_TIMEOUT_MS;
  const limiter = options.limiter ?? widgetLimiterOf(env);

  async function runOne(request: DashboardWidgetRequest): Promise<WidgetResult> {
    const key = cacheKey(request, scope);
    const cached = cache.get(key);
    if (cached !== undefined) return { id: request.id, status: 'ok', data: cached };
    try {
      const impl = impls.get(request.id);
      if (!impl) throw new Error(`Widget belum diimplementasikan: ${request.id}`);
      // Antre dalam urutan pemanggilan (tanpa await sebelum `run`), lalu hitung batas waktu setelah slot didapat.
      const data = await limiter.run(() =>
        withTimeout(
          impl.run({ env, db: env.DB, scope, filters: request.filters ?? {} }),
          timeoutMs,
        ),
      );
      cache.set(key, data);
      return { id: request.id, status: 'ok', data };
    } catch (error) {
      console.error(
        `[dashboard] widget ${request.id} gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { id: request.id, status: 'error', message: GENERIC_ERROR };
    }
  }

  return Promise.all(requests.map(runOne));
}
