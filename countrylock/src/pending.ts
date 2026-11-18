// Aturan antrean pending (daftar perangkat yang sudah di-inject dan belum diunggah ke server).
// Murni: pemanggil yang menyimpan/memuat daftar.

import type { Brand } from './script-template';

export interface PendingEntry {
  serial: string;
  brand: Brand | 'none';
  tipe: string;
  /** BU dan lokasi tujuan unggah (id dari katalog offline + label); kosong bila tak dipilih saat inject. */
  buId?: string;
  buLabel?: string;
  locationId?: string;
  locationLabel?: string;
  /** Tanggal lokal hari itu (tanpa jam). */
  date: string;
  /** Waktu pencatatan (ISO 8601). */
  timestamp: string;
  /** Waktu inject ulang terakhir pada serial yang sama (diisi hanya saat ada duplikat). */
  reinjectedAt?: string;
}

export type AddResult = 'success' | 'duplicated';

/**
 * Normalisasi serial: trim dan huruf besar, hanya itu. Format `58:D6` dan `58D6` sengaja TIDAK
 * disamakan (aplikasi lama juga tidak).
 */
export function normalizeSerial(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Menambah entri bila serialnya belum ada. Serial ganda tidak menimpa entri pertama; entri
 * pertama hanya memperoleh `reinjectedAt` (dari `timestamp` masukan). Daftar tidak dimutasi.
 */
export function addPending(
  list: readonly PendingEntry[],
  entry: PendingEntry,
): { list: PendingEntry[]; result: AddResult } {
  const serial = normalizeSerial(entry.serial);
  const index = list.findIndex((e) => normalizeSerial(e.serial) === serial);
  if (index < 0) return { list: [...list, { ...entry, serial }], result: 'success' };
  const next = [...list];
  const existing = list[index];
  if (existing) next[index] = { ...existing, reinjectedAt: entry.timestamp };
  return { list: next, result: 'duplicated' };
}

export function isRegistered(list: readonly PendingEntry[], serial: string): boolean {
  const key = normalizeSerial(serial);
  return list.some((e) => normalizeSerial(e.serial) === key);
}
