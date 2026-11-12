import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { onEvent, type SerialStockPayload } from '@server/core/events';
import { serialDeductStmts } from './stock-repo';

/** Pemotongan stok oleh Serial Number: pernyataan dipasang ke `batch()` penerbit (atomik dengan catatan serial). */
function deductListener(env: Env, payload: SerialStockPayload): DbStatement[] {
  return serialDeductStmts(env.DB, {
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
  onEvent('serial.stickers_added', deductListener);
}

registerSerialStockListeners();
