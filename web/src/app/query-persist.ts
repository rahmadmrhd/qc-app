import type { QueryClient } from '@tanstack/react-query';
import {
  getSession,
  LEGACY_PERSISTED_CACHE_KEYS,
  PERSISTED_CACHE_KEY,
} from '@/modules/auth/session';

/** Umur maksimal cache tersimpan; lebih tua dari ini dibuang (data tetap dimuat ulang di latar belakang bila basi). */
export const PERSIST_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Batas ukuran JSON yang ditulis ke localStorage (karakter). */
export const PERSIST_MAX_CHARS = 2_000_000;
const SAVE_DELAY_MS = 1500;

/**
 * Hanya query berikut yang disimpan: data referensi non-sensitif yang sering dibuka. TIDAK termasuk Log Audit, daftar
 * user, atau isi berkas. Daftar item tidak ikut: berkursor per filter dan murah dimuat (20 per halaman). Kuncinya `root/sub` dari dua bagian pertama queryKey (varian filter ikut, kecuali status `deleted`).
 */
const PERSISTED_KEYS: ReadonlySet<string> = new Set([
  'auth/me',
  'brands/list',
  'qrcodes/list',
  'qrcodes/defaults',
]);

interface PersistedEntry {
  key: unknown[];
  data: unknown;
  updatedAt: number;
}

/** Versi amplop; selaras dengan akhiran `PERSISTED_CACHE_KEY`. */
const PERSIST_VERSION = 3;

interface PersistedCache {
  v: typeof PERSIST_VERSION;
  owner: string;
  savedAt: number;
  entries: PersistedEntry[];
}

function keyId(key: readonly unknown[]): string {
  return key.map(String).join('/');
}

/** Apakah `value` (kunci, objek filter, atau larik, di kedalaman berapa pun) menyebut status `deleted`. */
function mentionsDeleted(value: unknown, depth = 0): boolean {
  if (value === 'deleted') return true;
  if (depth > 4 || typeof value !== 'object' || value === null) return false;
  const parts = Array.isArray(value) ? value : Object.values(value);
  return parts.some((part) => mentionsDeleted(part, depth + 1));
}

/**
 * Query daftar yang disaring ke record terhapus (soft delete, T21) tidak pernah disimpan: ia memuat data yang hanya
 * boleh dilihat pemegang izin Pulihkan dan tak boleh muncul sebagai data referensi tersimpan. Dikenali dari nilai
 * `'deleted'` di bagian kunci mana pun, termasuk di dalam objek filter atau larik bersarang.
 */
function filtersDeleted(key: readonly unknown[]): boolean {
  return mentionsDeleted(key);
}

/**
 * Whitelist dinilai dari dua bagian pertama kunci (`root/sub`): keputusan sadar (M6) agar daftar yang kelak berkunci
 * `['brands', 'list', { status }]` tetap tersimpan untuk filter Aktif/Nonaktif/Semua; varian `deleted` selalu
 * dikecualikan. Log Audit, user, dan isi berkas tetap di luar whitelist.
 */
function isPersistable(key: readonly unknown[]): boolean {
  return !filtersDeleted(key) && PERSISTED_KEYS.has(keyId(key.slice(0, 2)));
}

/** Apakah query dengan kunci ini termasuk data referensi yang disimpan (dipakai spanduk status server, FR-P16). */
export function isPersistedQueryKey(key: readonly unknown[]): boolean {
  return isPersistable(key);
}

/** Memasang cache tersimpan (stale-while-revalidate: tampil instan, lalu dimuat ulang di latar belakang bila basi). */
/** `owner` = email pengguna yang sesinya sudah diverifikasi server (GET /api/v1/me); cache milik orang lain dibuang. */
export function restoreQueryCache(queryClient: QueryClient, owner: string | null): number {
  try {
    // Cache bundel lama berbentuk data lama (mis. tanpa `businessUnits`/`businessUnitIds`): dibuang, tidak dipulihkan.
    for (const key of LEGACY_PERSISTED_CACHE_KEYS) localStorage.removeItem(key);
    if (!owner) return 0;
    const raw = localStorage.getItem(PERSISTED_CACHE_KEY);
    if (!raw) return 0;
    const saved = JSON.parse(raw) as PersistedCache;
    if (
      saved.v !== PERSIST_VERSION ||
      saved.owner !== owner ||
      Date.now() - saved.savedAt > PERSIST_MAX_AGE_MS
    ) {
      return 0;
    }
    let restored = 0;
    for (const entry of saved.entries) {
      if (!isPersistable(entry.key)) continue;
      queryClient.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt });
      restored++;
    }
    return restored;
  } catch {
    return 0;
  }
}

export function savePersistedQueryCache(queryClient: QueryClient): void {
  const owner = getSession().email;
  if (!owner) return;
  const entries: PersistedEntry[] = [];
  for (const query of queryClient.getQueryCache().findAll()) {
    if (query.state.status !== 'success' || !isPersistable(query.queryKey)) continue;
    entries.push({
      key: [...query.queryKey],
      data: query.state.data,
      updatedAt: query.state.dataUpdatedAt,
    });
  }
  try {
    if (entries.length === 0) return;
    const text = JSON.stringify({
      v: PERSIST_VERSION,
      owner,
      savedAt: Date.now(),
      entries,
    } satisfies PersistedCache);
    if (text.length > PERSIST_MAX_CHARS) return;
    localStorage.setItem(PERSISTED_CACHE_KEY, text);
  } catch {
    // Storage penuh/diblokir: cache hanya di memori.
  }
}

/** Menyimpan cache (ditunda dan digabung) setiap ada perubahan query, dan saat tab disembunyikan/ditutup. */
export function startQueryPersistence(queryClient: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    savePersistedQueryCache(queryClient);
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    if (timer === null) timer = setTimeout(flush, SAVE_DELAY_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    if (timer !== null) clearTimeout(timer);
  };
}
