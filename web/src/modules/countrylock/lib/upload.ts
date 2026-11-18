// Unggah antrean pending ke Daftar Serial Number (spek desktop §6.6, Fase 5; kontrak `serials.saveBatch`, sumber
// `countrylock`). Murni: pemetaan entri -> baris, alasan entri tak dapat diunggah, dan pembacaan hasil per baris.

import type { PendingEntry } from '@countrylock/pending';
import type { SerialRowInput, SerialRowResult } from '@shared/contract';

/** Baris per permintaan (server menerima maks. 200; potongan lebih kecil menjaga satu permintaan tetap singkat). */
export const UPLOAD_CHUNK = 100;

export { newClientId } from './client-id';

/**
 * Alasan entri belum dapat diunggah (`null` = siap). Entri lama (dicatat sebelum jembatan v7 atau tanpa katalog) tak
 * punya Tipe/BU/Lokasi/kunci idempoten; tidak ditebak: operator menghapusnya lalu menginject ulang.
 */
export function uploadBlocker(entry: PendingEntry): string | null {
  if (!entry.clientId || !entry.itemId) {
    return 'Dicatat tanpa Tipe katalog: hapus lalu inject ulang dengan Tipe dipilih.';
  }
  if (!entry.buId || !entry.locationId) {
    return 'BU atau Lokasi belum tercatat: hapus lalu inject ulang.';
  }
  return null;
}

export const isUploadable = (entry: PendingEntry): boolean => uploadBlocker(entry) === null;

/** Baris `serials.saveBatch`; stiker tidak dikirim = semua stiker yang berlaku dengan jumlah bawaan (aturan server). */
export function toSerialRow(entry: PendingEntry): SerialRowInput {
  return {
    clientId: entry.clientId ?? '',
    serial: entry.serial,
    itemId: entry.itemId ?? '',
    buId: entry.buId ?? '',
    testDate: entry.date,
    locationId: entry.locationId ?? '',
    sample: false,
    note: '',
    source: 'countrylock',
  };
}

export function chunkRows<T>(items: readonly T[], size = UPLOAD_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let from = 0; from < items.length; from += size) chunks.push(items.slice(from, from + size));
  return chunks;
}

export interface UploadOutcome {
  state: SerialRowResult['result'];
  message: string;
}

const DEFAULT_MESSAGES: Record<SerialRowResult['result'], string> = {
  created: 'Terunggah',
  duplicate: 'Serial sudah ada di BU ini',
  invalid: 'Baris ditolak server',
  error: 'Gagal disimpan, coba lagi',
};

/** Hasil server per baris -> hasil per serial (kunci = serial pada antrean); baris yang tak dikenali dilewati. */
export function outcomesBySerial(
  entries: readonly PendingEntry[],
  results: readonly SerialRowResult[],
): Map<string, UploadOutcome> {
  const serialOf = new Map(entries.map((entry) => [entry.clientId, entry.serial]));
  const outcomes = new Map<string, UploadOutcome>();
  for (const result of results) {
    const serial = serialOf.get(result.clientId);
    if (serial === undefined) continue;
    outcomes.set(serial, {
      state: result.result,
      message: result.message !== '' ? result.message : DEFAULT_MESSAGES[result.result],
    });
  }
  return outcomes;
}

export interface UploadSummary {
  created: number;
  duplicate: number;
  failed: number;
  /** Galat yang menghentikan unggah (jaringan, sesi, izin); baris yang belum terkirim tetap di antrean. */
  stopped: string | null;
}

export function summarize(
  outcomes: ReadonlyMap<string, UploadOutcome>,
  stopped: string | null,
): UploadSummary {
  let created = 0;
  let duplicate = 0;
  let failed = 0;
  for (const outcome of outcomes.values()) {
    if (outcome.state === 'created') created += 1;
    else if (outcome.state === 'duplicate') duplicate += 1;
    else failed += 1;
  }
  return { created, duplicate, failed, stopped };
}
