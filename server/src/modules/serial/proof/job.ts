import { appError } from '@server/core/errors';
import type { JobHandler } from '../../jobs/consumer';

/**
 * Job `serial_proof` (satu per foto bukti QC; rancangan 2026-11-16 §6.3). KERANGKA: isi (gambar cap, unggah Drive,
 * penyelesaian) diisi Task A6; kerangka dipasang lebih awal agar `handlerOf` lengkap dan Simpan (Task A5) dapat memasang
 * baris job.
 */
export const serialProofHandler: JobHandler = {
  async run() {
    throw appError('INTERNAL', 'Belum diimplementasi');
  },
};
