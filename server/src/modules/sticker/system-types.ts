import type { Env } from '@server/core/env';
import { ensureManualBookType } from './manual-book';
import { ensurePostelType } from './postel';
import { listStickerTypeRecords } from './repo';

/**
 * Menjamin jenis stiker sistem "Manual Book" dan "Postel" ada (keputusan pemilik 2026-11-25): keduanya terlihat di
 * daftar Jenis walau belum ada konfigurasi QR Manual Book atau catatan Postel, tidak lagi dibuat malas saat ekspor
 * atau catatan pertama. Dipanggil `createServer` tiap start setelah migrasi (bukan migrasi SQL: pemeriksa dump
 * pemulihan menolak pernyataan non-DDL biasa). Idempoten dan aman serentak (indeks unik `kind_key`).
 *
 * Jenis yang gagal dibuat (mis. jenis buatan orang bernama sama yang sudah berstiker, harus diganti namanya dulu)
 * dicatat tanpa menggagalkan start dan tanpa menghalangi jenis lainnya; jalur malas lama (ekspor, simpan Postel)
 * tetap menjadi cadangan dan melaporkan galat itu kepada pengguna.
 *
 * Adopsi (keputusan pemilik 2026-11-25): jenis buatan pengguna bernama "Manual Book"/"Postel" yang belum berstiker
 * diadopsi saat start menjadi jenis sistem (aturan `group`, selalu aktif, nama dan aturan terkunci); adopsi dicatat di
 * log (hanya nama baku jenis, tanpa data lain).
 */
export async function ensureSystemStickerTypes(env: Env, actor = 'system'): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['Manual Book', () => ensureManualBookType(env, actor)],
    ['Postel', () => ensurePostelType(env, { email: actor })],
  ];
  for (const [label, run] of steps) {
    try {
      const adoptable = await findAdoptable(env, label);
      await run();
      if (adoptable) {
        console.warn(
          `Jenis stiker buatan pengguna "${label}" diadopsi menjadi jenis sistem (aturan group, selalu aktif, nama dan aturan terkunci)`,
        );
      }
    } catch (error) {
      console.error(`Pembuatan jenis stiker sistem ${label} gagal:`, error);
    }
  }
}

/** Jenis biasa bernama sama (tanpa beda huruf besar) yang belum berstiker dan belum ada jenis sistemnya: calon adopsi. */
async function findAdoptable(env: Env, label: string): Promise<boolean> {
  const kind = label === 'Postel' ? 'postel' : 'manual_book';
  const types = await listStickerTypeRecords(env.DB);
  if (types.some((type) => type.systemKind === kind)) return false;
  return types.some(
    (type) =>
      type.systemKind === '' &&
      type.name.toLowerCase() === label.toLowerCase() &&
      type.stickerCount === 0,
  );
}
