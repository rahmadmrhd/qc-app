import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { statementsFor } from '@server/core/events';
import { insertEventStmt, insertSerialStickerStmt, insertSerialStmt } from './repo';

export interface NewSerialInput {
  serialId: string;
  eventId: string;
  /** Kunci idempoten baris (`serials.client_id`). */
  clientId: string;
  buId: string;
  serial: string;
  itemId: string;
  testDate: string;
  locationId: string;
  locationName: string;
  note: string;
  sample: boolean;
  actor: { id: string; name: string; email: string };
  /** Stiker yang dicentang beserta jumlahnya (kosong = tanpa stiker). */
  stickerPicks: readonly { stickerId: string; qty: number }[];
  /** Nama stiker untuk data kejadian (id yang tak ada di peta ditulis kosong). */
  stickerNames: ReadonlyMap<string, string>;
  /** Tambahan pada `data` kejadian `recorded` (mis. `source`, `orderId`). */
  eventData: Record<string, unknown>;
  occurredOn: string;
  now: string;
}

/**
 * Pernyataan pencatatan satu serial baru (status `good`, posisi QC): serial + stiker + kejadian `recorded` bernomor 1 +
 * pernyataan pendengar bus `serial.recorded` (pemotongan stok). Pemanggil menggabungkannya ke `batch()` miliknya
 * (foto bukti, penanda Keluar Gudang, dan sebagainya ditambahkan pemanggil). Dipakai bersama `createSerialOnce` dan
 * Keluar Gudang agar perilaku pencatatan satu.
 */
export async function newSerialStatements(
  env: Env,
  input: NewSerialInput,
  db: Preparer = env.DB,
): Promise<DbStatement[]> {
  const picks = input.stickerPicks.map((pick) => ({ stickerId: pick.stickerId, qty: pick.qty }));
  return [
    insertSerialStmt(db, {
      id: input.serialId,
      clientId: input.clientId,
      buId: input.buId,
      serial: input.serial,
      itemId: input.itemId,
      testDate: input.testDate,
      sample: input.sample,
      note: input.note,
      locationId: input.locationId,
      status: 'good',
      openCaseId: '',
      now: input.now,
      actorEmail: input.actor.email,
    }),
    ...picks.map((pick) => insertSerialStickerStmt(db, input.serialId, pick.stickerId, pick.qty)),
    insertEventStmt(db, {
      id: input.eventId,
      serialId: input.serialId,
      caseId: '',
      seq: 1,
      type: 'recorded',
      occurredOn: input.occurredOn,
      now: input.now,
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorTeam: 'qc',
      message: '',
      changes: [],
      data: {
        stickers: picks.map((pick) => ({
          stickerId: pick.stickerId,
          name: input.stickerNames.get(pick.stickerId) ?? '',
          qty: pick.qty,
        })),
        locationId: input.locationId,
        locationName: input.locationName,
        ...input.eventData,
      },
    }),
    ...(await statementsFor(env, 'serial.recorded', {
      serialId: input.serialId,
      eventId: input.eventId,
      locationId: input.locationId,
      picks,
      actor: input.actor.email,
      now: input.now,
    })),
  ];
}
