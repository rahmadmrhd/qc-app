import { type Env, nowOf } from '@server/core/env';
import type { DashboardWidgetRequest, WidgetData, WidgetResult } from '@shared/dashboard';
import { createTtlCache, type TtlCache } from './cache';
import { WIDGET_IMPLS, type WidgetImpl } from './registry';
import type { ResolvedScope } from './scope';

export const WIDGET_CONCURRENCY = 4;
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

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Widget melebihi batas waktu ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Menjalankan widget yang diminta: paling banyak `WIDGET_CONCURRENCY` bersamaan, batas waktu per widget, hasil `ok`
 * di-cache 30 detik. Satu widget yang gagal atau lambat menjadi `error` generik (galat asli hanya ke `console.error`)
 * tanpa menjatuhkan yang lain. TIDAK memeriksa izin: pemanggil menyaring permintaan dengan `allowedWidgetIds`.
 */
export async function runWidgets(
  env: Env,
  scope: ResolvedScope,
  requests: readonly DashboardWidgetRequest[],
  impls: ReadonlyMap<DashboardWidgetRequest['id'], WidgetImpl> = WIDGET_IMPLS,
  options: { timeoutMs?: number } = {},
): Promise<WidgetResult[]> {
  const cache = cacheOf(env);
  const timeoutMs = options.timeoutMs ?? WIDGET_TIMEOUT_MS;

  async function runOne(request: DashboardWidgetRequest): Promise<WidgetResult> {
    const key = cacheKey(request, scope);
    const cached = cache.get(key);
    if (cached !== undefined) return { id: request.id, status: 'ok', data: cached };
    try {
      const impl = impls.get(request.id);
      if (!impl) throw new Error(`Widget belum diimplementasikan: ${request.id}`);
      const data = await withTimeout(
        impl.run({ env, db: env.DB, scope, filters: request.filters ?? {} }),
        timeoutMs,
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

  const results: WidgetResult[] = new Array(requests.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const request = requests[index];
      if (request === undefined) return;
      results[index] = await runOne(request);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WIDGET_CONCURRENCY, requests.length) }, () => worker()),
  );
  return results;
}
