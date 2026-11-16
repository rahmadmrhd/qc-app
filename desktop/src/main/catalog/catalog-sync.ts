// Sinkron katalog Tipe offline dari server (spek desktop §6.6, keputusan pemilik 2026-11-16): potret utuh dengan ETag
// (`If-None-Match`), lalu hanya berkas gambar yang belum ada/ukurannya beda diunduh. Potret baru HANYA menggantikan
// yang lama setelah SEMUA berkasnya utuh (ukuran cocok daftar server, mime gambar, batas ukuran); gagal di tengah =
// katalog terakhir yang baik tetap dipakai. Satu sinkron pada satu waktu. Token bersama hanya di header (tak pernah
// dicatat atau dikembalikan ke renderer); respons server TIDAK dipercaya (bentuk divalidasi, id berkas aman).

import type { CatalogStatus } from '@countrylock/bridge-contract';
import { catalogFileIds, parseDesktopCatalog } from '@shared/desktop-catalog';
import type { Settings } from '../settings';
import type { CatalogStore } from './catalog-store';

export interface CatalogSyncDeps {
  store: CatalogStore;
  settings: () => Settings;
  /** Token bersama; `null` = build tanpa token (katalog dinonaktifkan). */
  token: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Status berubah (untuk diteruskan ke renderer). */
  onStatus?: (status: CatalogStatus) => void;
}

export interface CatalogSync {
  status(): CatalogStatus;
  /** Sinkron sekarang; panggilan serentak berbagi satu sinkron. Tidak pernah melempar. */
  refresh(): Promise<CatalogStatus>;
}

const REQUEST_TIMEOUT_MS = 20_000;
const FILE_TIMEOUT_MS = 60_000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 3;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

class SyncFailure extends Error {
  constructor(readonly kind: 'UNAVAILABLE' | 'REJECTED') {
    super(kind);
  }
}

/** Membaca badan hingga `max` byte; melebihi batas = galat (server salah isi tak boleh memenuhi memori). */
async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new SyncFailure('UNAVAILABLE');
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new SyncFailure('UNAVAILABLE');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function createCatalogSync(deps: CatalogSyncDeps): CatalogSync {
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  let running: Promise<CatalogStatus> | null = null;

  const stored = deps.store.read();
  let current: CatalogStatus = {
    state: deps.token === null ? 'disabled' : 'idle',
    itemCount: stored?.catalog.items.length ?? 0,
    syncedAt: stored?.syncedAt ?? null,
    error: null,
  };
  const publish = (next: CatalogStatus): CatalogStatus => {
    current = next;
    deps.onStatus?.(next);
    return next;
  };

  async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${deps.settings().serverUrl}${path}`, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new SyncFailure('UNAVAILABLE');
    }
    if (response.status >= 500) throw new SyncFailure('UNAVAILABLE');
    if (response.status === 429) throw new SyncFailure('UNAVAILABLE');
    // 404 seragam = token salah ATAU rute dinonaktifkan; 401/403/redirect juga berarti ditolak.
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      throw new SyncFailure('REJECTED');
    }
    if (response.status >= 300 && response.status !== 304) throw new SyncFailure('REJECTED');
    return response;
  }

  async function downloadMissing(
    token: string,
    files: readonly { id: string; mime: string; size: number }[],
  ): Promise<void> {
    const wanted = files.filter((file) => !deps.store.hasFile(file.id, file.size));
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const file = wanted[next++];
        if (!file) return;
        if (!IMAGE_MIMES.has(file.mime) || file.size > MAX_FILE_BYTES) {
          throw new SyncFailure('UNAVAILABLE');
        }
        const response = await request(
          `/api/desktop/catalog/files/${encodeURIComponent(file.id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
          FILE_TIMEOUT_MS,
        );
        if (response.status !== 200) throw new SyncFailure('UNAVAILABLE');
        const data = await readLimited(response, MAX_FILE_BYTES);
        // Ukuran harus persis daftar server: unduhan terpotong/salah isi tak pernah disimpan sebagai berkas sah.
        if (data.length !== file.size) throw new SyncFailure('UNAVAILABLE');
        deps.store.putFile(file.id, data);
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  }

  async function run(): Promise<CatalogStatus> {
    const token = deps.token;
    if (token === null) return publish({ ...current, state: 'disabled', error: null });
    publish({ ...current, state: 'syncing', error: null });
    try {
      const previous = deps.store.read();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (previous) headers['If-None-Match'] = `"${previous.etag}"`;
      const response = await request('/api/desktop/catalog', { headers }, REQUEST_TIMEOUT_MS);
      if (response.status === 304 && previous) {
        // Potret sama; berkas yang hilang dari disk (dibuang pengguna) diunduh ulang.
        await downloadMissing(token, previous.catalog.files);
        const syncedAt = new Date(now()).toISOString();
        deps.store.write({ ...previous, syncedAt });
        return publish({
          state: 'ok',
          itemCount: previous.catalog.items.length,
          syncedAt,
          error: null,
        });
      }
      if (response.status !== 200) throw new SyncFailure('UNAVAILABLE');
      const raw = new TextDecoder().decode(await readLimited(response, MAX_CATALOG_BYTES));
      let catalog: ReturnType<typeof parseDesktopCatalog>;
      try {
        catalog = parseDesktopCatalog(JSON.parse(raw));
      } catch {
        catalog = null;
      }
      if (!catalog) throw new SyncFailure('UNAVAILABLE');
      const etag = (response.headers.get('etag') ?? '').replace(/^W\//, '').replace(/"/g, '');
      if (etag === '') throw new SyncFailure('UNAVAILABLE');
      await downloadMissing(token, catalog.files);
      const syncedAt = new Date(now()).toISOString();
      deps.store.write({ catalog, etag, syncedAt });
      const present = new Set(catalog.files.map((file) => file.id));
      deps.store.prune(new Set([...catalogFileIds(catalog)].filter((id) => present.has(id))));
      return publish({ state: 'ok', itemCount: catalog.items.length, syncedAt, error: null });
    } catch (error) {
      const kind = error instanceof SyncFailure ? error.kind : 'UNAVAILABLE';
      return publish({ ...current, state: 'error', error: kind });
    }
  }

  return {
    status: () => current,
    refresh() {
      if (!running) {
        running = run().finally(() => {
          running = null;
        });
      }
      return running;
    },
  };
}
