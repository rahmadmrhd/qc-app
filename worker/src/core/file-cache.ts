import type { Env } from './env';

/** Cache isi berkas (teks base64 apa adanya; Worker tidak pernah men-decode). */
export interface FileCache {
  get(key: string): Promise<string | null>;
  put(key: string, mime: string, base64: string): Promise<void>;
}

/** Berkas tidak pernah diubah isinya (unggahan baru = id baru), jadi aman di-cache lama. */
const CACHE_TTL_SECONDS = 10_800;
/** Isi base64 lebih besar dari ini tidak di-cache. */
const CACHE_MAX_CHARS = 2_000_000;

/** Cache API Workers (`caches.default`); null di luar runtime Workers (mis. tes) kecuali disuntik. */
export function fileCacheOf(env: Env): FileCache | null {
  if (env.FILE_CACHE !== undefined) return env.FILE_CACHE;
  const caches = (globalThis as { caches?: { default?: Cache } }).caches;
  const store = caches?.default;
  if (!store) return null;
  return {
    async get(key) {
      const hit = await store.match(new Request(key));
      return hit ? await hit.text() : null;
    },
    async put(key, mime, base64) {
      if (base64.length > CACHE_MAX_CHARS) return;
      await store.put(
        new Request(key),
        new Response(base64, {
          headers: { 'content-type': mime, 'cache-control': `max-age=${CACHE_TTL_SECONDS}` },
        }),
      );
    },
  };
}

/** Kunci terikat folder aktif: mengganti folder membuat isi lama tidak terpakai lagi. */
export function fileCacheKey(folderId: string, driveId: string): string {
  return `https://files.cache.invalid/${encodeURIComponent(folderId)}/${encodeURIComponent(driveId)}`;
}
