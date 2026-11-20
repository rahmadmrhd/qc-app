import { API_ROUTES } from '@shared/api';
import {
  deprecatedGroupsInUse,
  type MinClient,
  parseMinClient,
  parseServerApis,
  pickApiId,
  type ServerApis,
} from '@shared/api-versions';
import type { ApiId } from '@shared/contract';
import { raiseOutdatedLevel } from '@/app/pwa/client-outdated';

// Peta versi API per kelompok yang diumumkan server lewat `/api/ping` (`apis`). Disimpan di memori dan salinan
// terakhirnya di `localStorage` (bukan data sensitif) supaya klien offline tetap memilih versi yang sama. Belum termuat
// = peta `null` = semua id jatuh ke v1. Semua yang datang dari server/penyimpanan diperlakukan tak tepercaya: nilai
// rusak diabaikan, tak pernah melempar.

const STORAGE_KEY = 'qc.api.apis';
const MIN_CLIENT_KEY = 'qc.api.minClient';
/** Jeda minimum antar penyegaran yang dipicu tab kembali terlihat. */
const VISIBLE_REFRESH_MS = 5 * 60 * 1000;

let current: ServerApis | null = null;
let loaded = false;
let currentMin: MinClient | null = null;
let minLoaded = false;
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

function readStoredMin(): MinClient | null {
  try {
    const raw = localStorage.getItem(MIN_CLIENT_KEY);
    return raw === null ? null : parseMinClient(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredMin(value: MinClient): void {
  try {
    localStorage.setItem(MIN_CLIENT_KEY, JSON.stringify(value));
  } catch {
    // Penyimpanan tak tersedia: nilai di memori tetap berlaku.
  }
}

/** `minClient` terakhir yang diumumkan server (memori, atau salinan tersimpan); `null` = belum pernah diumumkan. */
export function getServerMinClient(): MinClient | null {
  if (!minLoaded) {
    minLoaded = true;
    currentMin = readStoredMin();
  }
  return currentMin;
}

function setServerMinClient(value: unknown): void {
  const parsed = parseMinClient(value);
  if (parsed === null) return;
  minLoaded = true;
  currentMin = parsed;
  writeStoredMin(parsed);
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
    const body = (await response.json()) as { apis?: unknown; minClient?: unknown } | null;
    setServerApis(body?.apis);
    // Server lama tidak punya `minClient`: nilai yang sudah ada tak disentuh (tak sah = diabaikan).
    setServerMinClient(body?.minClient);
    // Klien ini hanya mengenal versi API yang sudah ditandai deprecated server: tampilkan spanduk (tanpa memuat ulang).
    if (deprecatedGroupsInUse(Object.keys(API_ROUTES), getServerApis()).length > 0) {
      raiseOutdatedLevel('deprecated');
    }
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
  currentMin = null;
  minLoaded = false;
  lastRefreshAt = 0;
}
