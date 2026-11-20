import { baseName, checkFile } from './accept';
import type { QueuedFile, RejectedFile } from './types';

let counter = 0;

/**
 * Pemeriksaan satu gelombang berkas yang masuk (pilih, seret, tempel): jenis dan ukuran lewat `checkFile`, sisa ruang
 * antrean lewat `room`. Yang lolos diberi kunci unik (tetap unik walau nama sama, juga antar panggilan) dan nama awal
 * dari nama berkas; yang ditolak membawa alasan siap tampil. `max` hanya untuk teks pesan (bawaan: `room`).
 */
export function intakeFiles(
  files: readonly File[],
  rule: {
    accept: readonly string[];
    maxBytes: number;
    nameMax?: number;
    room: number;
    max?: number;
  },
): { queued: QueuedFile[]; rejected: RejectedFile[] } {
  const queued: QueuedFile[] = [];
  const rejected: RejectedFile[] = [];
  let room = Math.max(0, rule.room);
  for (const file of files) {
    const reason = checkFile(file, { accept: rule.accept, maxBytes: rule.maxBytes });
    if (reason !== null) {
      rejected.push({ name: file.name, reason });
    } else if (room <= 0) {
      rejected.push({
        name: file.name,
        reason: `Maksimal ${rule.max ?? rule.room} berkas per unggahan`,
      });
    } else {
      room -= 1;
      counter += 1;
      queued.push({ key: `f${counter}`, file, name: baseName(file.name, rule.nameMax) });
    }
  }
  return { queued, rejected };
}
