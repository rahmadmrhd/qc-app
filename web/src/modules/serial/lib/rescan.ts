import type { StagingRow } from './draft';

/** Satu serial yang discan ulang di BU dan lokasi yang sama dengan pencatatan terakhirnya. */
export interface RescanWarning {
  /** Id baris draft (kunci daftar; serial yang sama dua kali di draf tetap unik). */
  clientId: string;
  serial: string;
  /** Pelaku kejadian terbaru ("Admin" bila server tak menyebutnya). */
  actorName: string;
  /** Waktu ISO kejadian terbaru ('' bila tak diketahui). */
  at: string;
}

/** Daftar serial yang ditampilkan di dialog sebelum dipotong "dan N lainnya". */
export const RESCAN_LIST_MAX = 20;

/**
 * Baris Cek ulang yang BU-nya sama dengan BU serial saat ini DAN lokasinya sama dengan lokasi unit saat ini.
 * Server hanya mengungkap lokasi unit untuk BU yang boleh dibaca pengguna; tanpa field itu tidak ada peringatan.
 */
export function findRescanWarnings(rows: readonly StagingRow[]): RescanWarning[] {
  const warnings: RescanWarning[] = [];
  for (const row of rows) {
    const existing = row.existing;
    if (!existing) continue;
    const unit = existing.unitLocationId;
    if (unit === undefined || unit === '' || row.locationId === '' || row.buId === '') continue;
    if (row.buId !== existing.buId || row.locationId !== unit) continue;
    warnings.push({
      clientId: row.clientId,
      serial: row.serial,
      actorName: existing.lastActorName?.trim() || 'Admin',
      at: existing.lastEventAt ?? '',
    });
  }
  // TODO(Bagian A, modul serialwh): serial buatan WH ditulis sebagai "Gudang" (spek serial-keluar-gudang bagian 6).
  return warnings;
}
