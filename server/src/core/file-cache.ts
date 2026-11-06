import type { Env } from './env';

/** Cache isi berkas (teks base64 apa adanya; server tidak men-decode isi berkas pada Fase 1). */
export interface CachedFile {
  mime: string;
  base64: string;
}

export interface FileCache {
  get(key: string): Promise<CachedFile | null>;
  put(key: string, mime: string, base64: string): Promise<void>;
  /** Membuang salinan berkas Drive `driveId` (ganti isi, sampah, yatim). */
  drop?(driveId: string): Promise<void>;
}

/** Isi base64 lebih besar dari ini tidak di-cache. */
const CACHE_MAX_CHARS = 2_000_000;
/** Total isi yang ditahan cache memori proses (karakter base64 = byte ASCII). */
export const FILE_CACHE_MAX_TOTAL_CHARS = 32 * 1024 * 1024;

const KEY_PREFIX = 'https://files.cache.invalid/';

/** Kunci terikat folder aktif: mengganti folder membuat isi lama tidak terpakai lagi. */
export function fileCacheKey(folderId: string, driveId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(folderId)}/${encodeURIComponent(driveId)}`;
}

function parseKey(key: string): { folderId: string; driveId: string } {
  const [folder = '', drive = ''] = key.slice(KEY_PREFIX.length).split('/');
  return { folderId: decodeURIComponent(folder), driveId: decodeURIComponent(drive) };
}

interface Entry {
  folderId: string;
  mime: string;
  base64: string;
}

/**
 * Cache memori LRU berbatas ukuran total, berkunci `driveId` (isi berkas Drive tidak berubah untuk id yang sama;
 * ganti isi = id baru). Entri mencatat folder induknya: folder yang tak cocok dengan folder aktif dianggap miss.
 * Map JavaScript mempertahankan urutan sisip, jadi entri tertua = kunci pertama (dipindah ke akhir saat dibaca).
 */
export function createMemoryFileCache(maxTotalChars = FILE_CACHE_MAX_TOTAL_CHARS): FileCache & {
  /** Total karakter yang sedang ditahan (untuk tes). */
  readonly size: number;
} {
  const entries = new Map<string, Entry>();
  let total = 0;
  const remove = (driveId: string) => {
    const old = entries.get(driveId);
    if (!old) return;
    total -= old.base64.length;
    entries.delete(driveId);
  };
  return {
    get size() {
      return total;
    },
    async get(key) {
      const { folderId, driveId } = parseKey(key);
      const entry = entries.get(driveId);
      if (!entry || entry.folderId !== folderId) return null;
      entries.delete(driveId);
      entries.set(driveId, entry); // paling baru dipakai
      return { mime: entry.mime, base64: entry.base64 };
    },
    async put(key, mime, base64) {
      if (base64.length > CACHE_MAX_CHARS || base64.length > maxTotalChars) return;
      const { folderId, driveId } = parseKey(key);
      remove(driveId);
      entries.set(driveId, { folderId, mime, base64 });
      total += base64.length;
      while (total > maxTotalChars) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        remove(oldest.value);
      }
    },
    async drop(driveId) {
      remove(driveId);
    },
  };
}

/** Cache bawaan proses (satu per proses server). */
let defaultCache: FileCache | null = null;

/**
 * Cache yang dipakai: `FILE_CACHE` (disuntik tes; `null` = tanpa cache), bila tidak diisi cache memori LRU
 * proses (maks. 32 MB).
 */
export function fileCacheOf(env: Env): FileCache | null {
  if (env.FILE_CACHE !== undefined) return env.FILE_CACHE;
  defaultCache ??= createMemoryFileCache();
  return defaultCache;
}

/**
 * Isi berkas: cache dulu, bila miss ambil lewat `load` (jembatan) lalu simpan. Pemeriksaan izin dan folder induk
 * HARUS sudah dilakukan pemanggil sebelum ini (cache tidak boleh melewati otorisasi). Galat cache tidak pernah
 * menggagalkan permintaan.
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
  if (content && cache) await cache.put(key, content.mime, content.base64).catch(() => undefined);
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
