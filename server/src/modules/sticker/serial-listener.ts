import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { onEvent, type SerialStockPayload } from '@server/core/events';
import { serialDeductStmts } from './stock-repo';

/** Pemotongan stok oleh Serial Number: pernyataan dipasang ke `batch()` penerbit (atomik dengan catatan serial). */
function deductListener(env: Env, payload: SerialStockPayload): DbStatement[] {
  return serialDeductStmts(env.DB, {
    rejectInactive: false,
    serialId: payload.serialId,
    eventId: payload.eventId,
    locationId: payload.locationId,
    picks: payload.picks,
    actor: payload.actor,
    now: payload.now,
  });
}

/**
 * Kenaikan jumlah stiker pada cek ulang: seperti pemotongan biasa, tetapi batal bila stiker `inactive` (penjaga atomik
 * dalam batch yang sama; keputusan pemilik 2026-11-13). Stiker `deprecated` tetap boleh.
 */
function raiseListener(env: Env, payload: SerialStockPayload): DbStatement[] {
  return serialDeductStmts(env.DB, {
    rejectInactive: true,
    serialId: payload.serialId,
    eventId: payload.eventId,
    locationId: payload.locationId,
    picks: payload.picks,
    actor: payload.actor,
    now: payload.now,
  });
}

/** Mendaftarkan pendengar stok (idempoten); dipanggil saat modul dimuat dan oleh tes setelah mereset bus. */
export function registerSerialStockListeners(): void {
  onEvent('serial.recorded', deductListener);
  onEvent('serial.stickers_added', raiseListener);
}

registerSerialStockListeners();
