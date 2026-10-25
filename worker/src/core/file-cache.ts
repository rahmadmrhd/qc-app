import type { Env } from './env';

/** Cache isi berkas (teks base64 apa adanya; Worker tidak pernah men-decode). */
export interface CachedFile {
  mime: string;
  base64: string;
}

export interface FileCache {
  get(key: string): Promise<CachedFile | null>;
  put(key: string, mime: string, base64: string): Promise<void>;
  /** Membuang salinan berkas Drive `driveId` (ganti isi, sampah, yatim). Tidak semua cache mendukungnya. */
  drop?(driveId: string): Promise<void>;
}

/** Isi base64 lebih besar dari ini tidak di-cache. */
const CACHE_MAX_CHARS = 2_000_000;
/** Cache API: berkas Drive yang di-cache tidak berubah isinya (id baru = berkas baru), jadi aman lama. */
const CACHE_TTL_SECONDS = 10_800;

const KEY_PREFIX = 'https://files.cache.invalid/';

/** Kunci terikat folder aktif: mengganti folder membuat isi lama tidak terpakai lagi. */
export function fileCacheKey(folderId: string, driveId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(folderId)}/${encodeURIComponent(driveId)}`;
}

function parseKey(key: string): { folderId: string; driveId: string } {
  const [folder = '', drive = ''] = key.slice(KEY_PREFIX.length).split('/');
  return { folderId: decodeURIComponent(folder), driveId: decodeURIComponent(drive) };
}

/**
 * R2 sebagai cache isi berkas (Spek 8.4): objek `f/<driveId>` berisi teks base64 apa adanya; `mime` dan
 * folder induk di customMetadata. Folder yang tak cocok dengan folder aktif dianggap miss. Drive tetap
 * sumber utama.
 */
function r2Cache(bucket: R2Bucket): FileCache {
  const objectKey = (driveId: string) => `f/${driveId}`;
  return {
    async get(key) {
      const { folderId, driveId } = parseKey(key);
      const object = await bucket.get(objectKey(driveId));
      if (!object) return null;
      const meta = object.customMetadata ?? {};
      if (meta.folder !== folderId) return null;
      return { mime: meta.mime ?? '', base64: await object.text() };
    },
    async put(key, mime, base64) {
      if (base64.length > CACHE_MAX_CHARS) return;
      const { folderId, driveId } = parseKey(key);
      await bucket.put(objectKey(driveId), base64, { customMetadata: { mime, folder: folderId } });
    },
    async drop(driveId) {
      await bucket.delete(objectKey(driveId));
    },
  };
}

/** Cache API Workers (`caches.default`). */
function cacheApi(store: Cache): FileCache {
  return {
    async get(key) {
      const hit = await store.match(new Request(key));
      if (!hit) return null;
      return { mime: hit.headers.get('content-type') ?? '', base64: await hit.text() };
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

/**
 * Cache yang dipakai: `FILE_CACHE` (disuntik tes), lalu R2 (`FILES_CACHE`, opsional), lalu Cache API
 * Workers; null di luar runtime Workers. Tanpa binding R2 perilaku sama seperti sebelumnya.
 */
export function fileCacheOf(env: Env): FileCache | null {
  if (env.FILE_CACHE !== undefined) return env.FILE_CACHE;
  if (env.FILES_CACHE) return r2Cache(env.FILES_CACHE);
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  return store ? cacheApi(store) : null;
}

/**
 * Isi berkas: cache dulu, bila miss ambil lewat `load` (jembatan) lalu simpan. Pemeriksaan izin dan folder induk
 * HARUS sudah dilakukan pemanggil sebelum ini (cache tidak boleh melewati otorisasi). Galat cache tidak pernah
 * menggagalkan permintaan; penyimpanan berjalan di latar (`WAIT_UNTIL`) bila tersedia.
 */
export async function cachedFileContent(
  env: Env,
  folderId: string,
  driveId: string,
  load: () => Promise<CachedFile | null>,
): Promise<CachedFile | null> {
  const cache = fileCacheOf(env);
  const key = fileCacheKey(folderId, driveId);
  if (cache) {
    const hit = await cache.get(key).catch(() => null);
    if (hit !== null) return hit;
  }
  const content = await load();
  if (content && cache) {
    const store = cache.put(key, content.mime, content.base64).catch(() => undefined);
    if (env.WAIT_UNTIL) env.WAIT_UNTIL(store);
    else await store;
  }
  return content;
}

/** Buang salinan berkas Drive dari cache (ganti isi, sampah, yatim); galat cache diabaikan. */
export async function dropCachedFile(env: Env, driveId: string): Promise<void> {
  const cache = fileCacheOf(env);
  if (!cache?.drop) return;
  await cache.drop(driveId).catch((error: unknown) => {
    console.error(`cache berkas ${driveId} gagal dibuang: ${String(error)}`);
  });
}
