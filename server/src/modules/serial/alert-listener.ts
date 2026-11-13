import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { onEvent, type SerialBrokenPayload } from '@server/core/events';
import { serialAlertJobStmt } from './alert-job';

/**
 * Pendengar `serial.declared_broken`: memasang satu baris job surel ke `batch()` aksi (atomik dengan aksinya; aksi yang
 * gagal atau stale tidak meninggalkan job). Dipasang lewat impor efek-samping dari `act.ts`.
 */
function brokenListener(env: Env, payload: SerialBrokenPayload): DbStatement[] {
  return [
    serialAlertJobStmt(env, {
      serialId: payload.serialId,
      caseId: payload.caseId,
      eventId: payload.eventId,
    }),
  ];
}

/** Mendaftarkan pendengar (idempoten); dipanggil saat modul dimuat dan oleh tes setelah mereset bus. */
export function registerSerialAlertListener(): void {
  onEvent('serial.declared_broken', brokenListener);
}

registerSerialAlertListener();
