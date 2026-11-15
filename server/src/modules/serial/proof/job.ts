import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { insertJobStmt } from '@server/modules/jobs/repo';
import { JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import type { JobHandler } from '../../jobs/consumer';

/** Pernyataan `INSERT` job `serial_proof` (satu per foto; `input` = `{ photoId }`; dibuat sistem). */
export function serialProofJobStmt(env: Env, photoId: string): DbStatement {
  const now = nowIso(env);
  return insertJobStmt(env.DB, {
    id: crypto.randomUUID(),
    kind: 'serial_proof',
    status: 'queued',
    progress: 0,
    result: '',
    error: '',
    createdBy: JOB_SYSTEM_ACTOR,
    createdAt: now,
    updatedAt: now,
    input: JSON.stringify({ photoId }),
    state: '',
    step: 0,
    leaseUntil: 0,
  });
}

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
