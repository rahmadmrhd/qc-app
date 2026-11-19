import { API_ROUTES } from '@shared/api';
import { parseServerApis, pickApiId, type ServerApis } from '@shared/api-versions';
import type { ApiId } from '@shared/contract';

// Peta versi API per kelompok yang diumumkan server lewat `/api/ping` (`apis`). Disimpan di memori dan salinan
// terakhirnya di `localStorage` (bukan data sensitif) supaya klien offline tetap memilih versi yang sama. Belum termuat
// = peta `null` = semua id jatuh ke v1. Semua yang datang dari server/penyimpanan diperlakukan tak tepercaya: nilai
// rusak diabaikan, tak pernah melempar.

const STORAGE_KEY = 'qc.api.apis';
/** Jeda minimum antar penyegaran yang dipicu tab kembali terlihat. */
const VISIBLE_REFRESH_MS = 5 * 60 * 1000;

let current: ServerApis | null = null;
let loaded = false;
let lastRefreshAt = 0;
let stopListening: (() => void) | null = null;

function readStored(): ServerApis | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parseServerApis(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStored(value: ServerApis): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Penyimpanan tak tersedia (mode privat, kuota): peta di memori tetap berlaku.
  }
}

/** Peta terakhir yang diketahui (memori, atau salinan tersimpan saat pertama dibaca); `null` = belum ada. */
export function getServerApis(): ServerApis | null {
  if (!loaded) {
    loaded = true;
    current = readStored();
  }
  return current;
}

/** Mengganti peta bila `value` sah (lewat `parseServerApis`); nilai tak sah diabaikan. */
export function setServerApis(value: unknown): void {
  const parsed = parseServerApis(value);
  if (parsed === null) return;
  loaded = true;
  current = parsed;
  writeStored(parsed);
}

/** Mengambil `/api/ping` dan memperbarui peta; galat jaringan atau respons buruk ditelan (peta lama tetap). */
export async function refreshServerApis(fetchImpl: typeof fetch = fetch): Promise<void> {
  lastRefreshAt = Date.now();
  try {
    const response = await fetchImpl('/api/ping', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const body = (await response.json()) as { apis?: unknown } | null;
    setServerApis(body?.apis);
  } catch {
    // Offline atau badan bukan JSON: tetap pakai peta yang ada.
  }
}

/** Id yang dipakai untuk id dasar `base`: versi tertinggi yang ada di tabel dan diumumkan server (v1 bila belum tahu). */
export function pickApi(base: ApiId): ApiId {
  return pickApiId(base, Object.keys(API_ROUTES), getServerApis()) as ApiId;
}

/**
 * Memulai pemuatan peta: membaca salinan tersimpan, menyegarkan saat mulai, saat `online`, dan saat tab kembali
 * terlihat (paling sering sekali per 5 menit). Aman dipanggil berulang (pendengar tidak digandakan).
 */
export function startApiVersions(): void {
  getServerApis();
  void refreshServerApis();
  if (stopListening !== null) return;
  const onOnline = () => void refreshServerApis();
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastRefreshAt < VISIBLE_REFRESH_MS) return;
    void refreshServerApis();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  stopListening = () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export function resetServerApisForTests(): void {
  stopListening?.();
  stopListening = null;
  current = null;
  loaded = false;
  lastRefreshAt = 0;
}
