import { type Env, nowOf } from './env';

/**
 * Cache memori per isolate (variabel modul) untuk tabel kecil yang dibaca hampir tiap permintaan: konteks
 * akses (users/roles/locations), `brands`, `customers`. Spek §6 mengizinkan cache pendek (<= 15 dtk);
 * di sini TTL bawaan 10 dtk dan dibatasi 15 dtk. Konsekuensi: perubahan dari isolate lain (juga pencabutan
 * akses) tampak paling lambat TTL kemudian. Di isolate yang sama kunci dibuang SEKETIKA saat pernyataan tulis
 * disusun (`touchCache`) dan sekali lagi di akhir permintaan (`settleCache`), jadi penulis selalu membaca
 * tulisannya sendiri. Tidak memakai KV/R2/Cache API/Durable Objects.
 *
 * Jalur yang memutuskan penulisan (sinkron, tulis merk/customer, pencarian sebelum membuat) membaca
 * LANGSUNG dari D1 (`fresh`), bukan dari cache.
 *
 * Dimatikan dengan `CACHE_TTL_MS=0`; tes memakai `resetMemCache()` (dipanggil `createTestEnv`).
 */
export const CACHE_TTL_DEFAULT_MS = 10_000;
export const CACHE_TTL_MAX_MS = 15_000;

interface Entry {
  expires: number;
  generation: number;
  value: unknown;
}

const entries = new Map<string, Entry>();
const generations = new Map<string, number>();
const touched = new Set<string>();

export function cacheTtlMs(env: Env): number {
  const raw = env.CACHE_TTL_MS;
  if (raw === undefined || raw.trim() === '') return CACHE_TTL_DEFAULT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, CACHE_TTL_MAX_MS);
}

function groupOf(key: string): string {
  const at = key.indexOf(':');
  return at === -1 ? key : key.slice(0, at);
}

function generationOf(group: string): number {
  return generations.get(group) ?? 0;
}

/** Mengisi kunci LAIN dari data yang sudah dibaca pemuat yang sama (tanpa round trip tambahan). */
export type Prime = (key: string, value: unknown) => void;

/**
 * Nilai dari cache bila masih segar; bila tidak, `load()` lalu simpan (kecuali kunci disentuh selama memuat).
 * `load` boleh mengisi kunci lain lewat `prime` (mis. konteks akses dan daftar lokasi dibaca dalam SATU round
 * trip D1: satu miss, bukan dua).
 */
export async function cached<T>(
  env: Env,
  key: string,
  load: (prime: Prime) => Promise<T>,
): Promise<T> {
  const ttl = cacheTtlMs(env);
  if (ttl === 0) return load(() => undefined);
  const now = nowOf(env);
  const hit = entries.get(key);
  const group = groupOf(key);
  if (hit && hit.expires > now && hit.generation === generationOf(group)) return hit.value as T;
  const startGenerations = new Map(generations);
  const primed: Array<[string, unknown]> = [];
  const value = await load((primeKey, primeValue) => {
    primed.push([primeKey, primeValue]);
  });
  // Ada penulisan (touch) selama memuat: nilai ini mungkin sudah basi, jangan disimpan.
  const store = (storeKey: string, storeValue: unknown) => {
    const storeGroup = groupOf(storeKey);
    const generation = startGenerations.get(storeGroup) ?? 0;
    if (generation === generationOf(storeGroup)) {
      entries.set(storeKey, { expires: now + ttl, generation, value: storeValue });
    }
  };
  store(key, value);
  for (const [primeKey, primeValue] of primed) store(primeKey, primeValue);
  return value;
}

function drop(group: string): void {
  generations.set(group, generationOf(group) + 1);
  for (const key of entries.keys()) {
    if (groupOf(key) === group) entries.delete(key);
  }
}

/** Dipanggil saat menyusun pernyataan tulis ke tabel dalam `group` (mis. `brands`, `customers`, `access`). */
export function touchCache(group: string): void {
  touched.add(group);
  drop(group);
}

/** Akhir permintaan: buang lagi semua kelompok yang disentuh (penulisan baru selesai setelah penyusunan). */
export function settleCache(): void {
  for (const group of touched) drop(group);
  touched.clear();
}

export function resetMemCache(): void {
  entries.clear();
  generations.clear();
  touched.clear();
}
