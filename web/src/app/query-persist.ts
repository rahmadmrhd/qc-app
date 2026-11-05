import type { QueryClient } from '@tanstack/react-query';
import { getSession, PERSISTED_CACHE_KEY } from '@/modules/auth/session';

/** Umur maksimal cache tersimpan; lebih tua dari ini dibuang (data tetap dimuat ulang di latar belakang bila basi). */
export const PERSIST_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Batas ukuran JSON yang ditulis ke localStorage (karakter). */
export const PERSIST_MAX_CHARS = 2_000_000;
const SAVE_DELAY_MS = 1500;

/**
 * Hanya query berikut yang disimpan: data referensi non-sensitif yang sering dibuka. TIDAK termasuk Log Audit, daftar
 * user, atau isi berkas. Daftar item tidak ikut: berkursor per filter dan murah dimuat (20 per halaman). Kuncinya `root/sub` dari queryKey.
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

interface PersistedCache {
  v: 1;
  owner: string;
  savedAt: number;
  entries: PersistedEntry[];
}

function keyId(key: readonly unknown[]): string {
  return key.map(String).join('/');
}

/** Memasang cache tersimpan (stale-while-revalidate: tampil instan, lalu dimuat ulang di latar belakang bila basi). */
/** `owner` = email pengguna yang sesinya sudah diverifikasi server (GET /api/v1/me); cache milik orang lain dibuang. */
export function restoreQueryCache(queryClient: QueryClient, owner: string | null): number {
  if (!owner) return 0;
  try {
    const raw = localStorage.getItem(PERSISTED_CACHE_KEY);
    if (!raw) return 0;
    const saved = JSON.parse(raw) as PersistedCache;
    if (saved.v !== 1 || saved.owner !== owner || Date.now() - saved.savedAt > PERSIST_MAX_AGE_MS) {
      return 0;
    }
    let restored = 0;
    for (const entry of saved.entries) {
      if (!PERSISTED_KEYS.has(keyId(entry.key))) continue;
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
    if (query.state.status !== 'success' || !PERSISTED_KEYS.has(keyId(query.queryKey))) continue;
    entries.push({
      key: [...query.queryKey],
      data: query.state.data,
      updatedAt: query.state.dataUpdatedAt,
    });
  }
  try {
    if (entries.length === 0) return;
    const text = JSON.stringify({
      v: 1,
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
