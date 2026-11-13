import type { HandoverDto } from '@shared/contract';
import { applyOptimisticCheck } from './optimistic-check';

/**
 * Antrean centang di perangkat (FR-P17, FR-P19): hanya `handovers.setCheck` yang gagal `UNAVAILABLE`. Disimpan di
 * `localStorage` per pemilik akun; isinya cuma yang dibutuhkan untuk mengirim ulang (NFR-P4: tanpa isi catatan lain).
 */
export interface OutboxEntry {
  /** Unik per entri: penghapusan selalu per `id`, jadi entri pengganti yang lebih baru tak ikut terhapus. */
  id: string;
  taskId: string;
  locationId: string;
  index: number;
  /** Teks satu butir checklist (dibutuhkan kontrak `SetCheckInput` untuk penjaga "catatan berubah"). */
  text: string;
  checked: boolean;
  at: number;
}

export const OUTBOX_KEY_PREFIX = 'qc.outbox:';
export const OUTBOX_MAX_ENTRIES = 200;
export const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Entri bertanggal lebih dari ini di masa depan (jam perangkat salah) dianggap kedaluwarsa agar tak menetap selamanya. */
export const OUTBOX_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const VERSION = 1;

export const outboxKey = (owner: string): string => `${OUTBOX_KEY_PREFIX}${owner}`;

let idCounter = 0;
function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Konteks tak aman: pakai cadangan.
  }
  idCounter += 1;
  return `o${Date.now().toString(36)}-${idCounter}`;
}

function isEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.taskId === 'string' &&
    typeof e.locationId === 'string' &&
    typeof e.index === 'number' &&
    Number.isInteger(e.index) &&
    typeof e.text === 'string' &&
    typeof e.checked === 'boolean' &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at)
  );
}

/** Membaca satu kunci antrean; entri tak valid dibuang, amplop rusak/berversi lain = kosong. */
function readKey(key: string): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const envelope = parsed as { v?: unknown; entries?: unknown };
    if (envelope.v !== VERSION || !Array.isArray(envelope.entries)) return [];
    return envelope.entries.filter(isEntry);
  } catch {
    return [];
  }
}

export function readOutbox(owner: string): OutboxEntry[] {
  return readKey(outboxKey(owner));
}

// Pelanggan + penghitung versi (snapshot `useSyncExternalStore`).
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent): void {
  // `key === null` = `localStorage.clear()` di tab lain.
  if (event.key === null || event.key.startsWith(OUTBOX_KEY_PREFIX)) notify();
}

export function subscribeOutbox(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export function outboxVersion(): number {
  return version;
}

/**
 * Setelah keluar eksplisit, penulisan antrean ditahan sampai `resumeOutboxWrites`: permintaan centang yang masih terbang
 * saat keluar bisa gagal `UNAVAILABLE` dan, tanpa ini, menulis antrean pemilik lama kembali (pola yang sama dengan draf
 * Serial Number).
 */
let writesSuspended = false;

export function suspendOutboxWrites(): void {
  writesSuspended = true;
}

/** Sesi kerja baru (penyinkron dimulai untuk pemilik yang sah): penulisan diizinkan lagi. */
export function resumeOutboxWrites(): void {
  writesSuspended = false;
}

export function outboxWritesSuspended(): boolean {
  return writesSuspended;
}

/** Menulis daftar (kosong = kunci dibuang). `false` bila penyimpanan penuh/diblokir. */
function write(owner: string, entries: readonly OutboxEntry[]): boolean {
  if (writesSuspended) return false;
  try {
    if (entries.length === 0) localStorage.removeItem(outboxKey(owner));
    else localStorage.setItem(outboxKey(owner), JSON.stringify({ v: VERSION, entries }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Mengantrekan satu centang. Entri dengan task+indeks sama digantikan (nilai terakhir menang) dan dipindah ke akhir.
 * `false` bila antrean penuh (setelah penggabungan) atau penyimpanan gagal: pemanggil harus menampilkan galat biasa.
 */
export function enqueueCheck(owner: string, entry: Omit<OutboxEntry, 'id'>): boolean {
  if (writesSuspended) return false;
  const kept = readOutbox(owner).filter(
    (existing) => !(existing.taskId === entry.taskId && existing.index === entry.index),
  );
  if (kept.length >= OUTBOX_MAX_ENTRIES) return false;
  if (!write(owner, [...kept, { ...entry, id: newId() }])) return false;
  notify();
  return true;
}

export function removeEntries(owner: string, ids: readonly string[]): void {
  const drop = new Set(ids);
  const current = readOutbox(owner);
  const next = current.filter((entry) => !drop.has(entry.id));
  if (next.length === current.length) return;
  write(owner, next);
  notify();
}

export function hasEntriesForTask(owner: string, taskId: string): boolean {
  return readOutbox(owner).some((entry) => entry.taskId === taskId);
}

/** Entri sudah lewat 24 jam, atau bertanggal terlalu jauh di masa depan (jam perangkat salah): tak akan dikirim. */
export function isExpiredEntry(entry: OutboxEntry, now: number): boolean {
  return now - entry.at > OUTBOX_MAX_AGE_MS || entry.at - now > OUTBOX_MAX_FUTURE_SKEW_MS;
}

/** Membuang entri yang lebih tua dari 24 jam dan mengembalikannya (untuk toast "kedaluwarsa"). */
export function purgeExpired(owner: string, now: number): OutboxEntry[] {
  const current = readOutbox(owner);
  const isExpired = (entry: OutboxEntry) => isExpiredEntry(entry, now);
  const expired = current.filter(isExpired);
  if (expired.length === 0) return [];
  if (
    !write(
      owner,
      current.filter((entry) => !isExpired(entry)),
    )
  )
    return [];
  notify();
  return expired;
}

function outboxKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(OUTBOX_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    // Penyimpanan tak tersedia.
  }
  return keys;
}

/**
 * Jumlah entri VALID dan belum kedaluwarsa dari SEMUA kunci `qc.outbox:*` (semua pemilik): yang akan terbuang bila
 * keluar. Entri kedaluwarsa tak dihitung (tak akan pernah terkirim). 0 bila penyimpanan tak tersedia atau amplop rusak.
 */
export function countAllOutboxEntries(): number {
  const now = Date.now();
  let total = 0;
  for (const key of outboxKeys()) {
    total += readKey(key).filter((entry) => !isExpiredEntry(entry, now)).length;
  }
  return total;
}

/** Keluar eksplisit: buang SEMUA antrean (sesi kedaluwarsa/401 tidak memanggil ini). */
export function clearAllOutboxes(): void {
  const keys = outboxKeys();
  try {
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Dibiarkan.
  }
  if (keys.length > 0) notify();
}

/** Pemilik lain login di perangkat yang sama: antrean pemilik lama dibuang diam-diam, tak pernah dikirim. */
export function purgeForeignOutboxes(owner: string): void {
  const own = outboxKey(owner);
  const keys = outboxKeys().filter((key) => key !== own);
  try {
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Dibiarkan.
  }
  if (keys.length > 0) notify();
}

/**
 * Menempelkan centang tertunda ke DTO untuk tampilan: butir tetap tercentang walau refetch tiba sebelum antrean
 * terkirim. Entri yang teksnya tak lagi cocok dengan butir (catatan berubah) diabaikan.
 */
export function overlayPendingChecks(
  dto: HandoverDto,
  entries: readonly OutboxEntry[],
  by: string,
  nowIso: string,
): HandoverDto {
  let result = dto;
  for (const entry of entries) {
    if (entry.taskId !== dto.id) continue;
    const item = dto.checklist.find((candidate) => candidate.index === entry.index);
    if (!item || item.text !== entry.text) continue;
    result = applyOptimisticCheck(result, entry.index, entry.checked, by, nowIso);
  }
  return result;
}
