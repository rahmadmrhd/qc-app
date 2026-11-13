import { batchGuarded } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { statementsFor } from '@server/core/events';
import type { UserContext } from '@server/modules/access/context';
import type { SerialActInput, SerialChangeDto, SerialDto } from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import type { SerialEventType } from '@shared/serials';
import { applicableStickersOf } from './applicable';
import {
  activeLocationName,
  insertNextEventStmt,
  loadSerialStickers,
  type SerialColumn,
  updateSerialStmt,
  upsertSerialStickerStmt,
} from './repo';
import {
  LOCATION_MESSAGE,
  loadSerialDto,
  loadWritableRow,
  nextStamp,
  SERIAL_CONFLICTS,
  STALE_MESSAGE,
  toStickerStatus,
  validationError,
} from './service';

const stickerChip = (name: string, qty: number | null): string | null =>
  qty === null ? null : `${name} ×${qty}`;

/**
 * `serials.act` (5a): `note` menulis kejadian catatan; `recheck` (hanya `good` di `qc`) menulis kejadian cek ulang,
 * memindahkan lokasi bila berbeda (`recorded_location_id` tetap), dan menaikkan jumlah stiker: selisih positif
 * memotong stok di lokasi cek ulang lewat pendengar `serial.stickers_added` dalam batch yang sama.
 */
export async function actOnSerial(
  env: Env,
  input: SerialActInput,
  user: UserContext,
): Promise<SerialDto> {
  const today = wibDateIso(nowOf(env));
  if (input.occurredOn > today) {
    throw validationError('occurredOn', 'Tanggal tidak boleh di masa depan');
  }
  const row = await loadWritableRow(env, user, input.id, input.expectedUpdatedAt);
  const serialId = row.id.trim();
  const eventId = crypto.randomUUID();
  const now = nextStamp(nowIso(env), row.updated_at);
  const set: Partial<Record<SerialColumn, string | number>> = {};
  const changes: SerialChangeDto[] = [];
  const statements: DbStatement[] = [];
  let data: Record<string, unknown> = {};
  let eventType: SerialEventType = 'note';
  const tail: DbStatement[] = [];

  if (input.action === 'recheck') {
    eventType = 'recheck';
    if (row.status.trim() !== 'good' || row.custody.trim() !== 'qc') {
      throw appError('CONFLICT', 'Serial tidak dapat dicek ulang pada keadaan ini');
    }
    const locationId = input.locationId ?? row.location_id.trim();
    let locationName = row.location_name ?? '';
    if (locationId !== row.location_id.trim()) {
      const name = await activeLocationName(env.DB, locationId);
      if (name === null) throw validationError('locationId', LOCATION_MESSAGE);
      set.location_id = locationId;
      changes.push({ field: 'location', from: locationName, to: name });
      locationName = name;
    }
    // Lokasi yang tidak diganti boleh sudah nonaktif: hanya lokasi BARU yang wajib aktif (diperiksa di atas).
    data = { result: 'pass', locationId, locationName };

    const current = new Map(
      (await loadSerialStickers(env.DB, serialId)).map((sticker) => [
        sticker.sticker_id.trim(),
        {
          qty: Number(sticker.qty),
          name: sticker.name ?? '',
          status: toStickerStatus(sticker.status),
        },
      ]),
    );
    const requested = input.stickers ?? [];
    const unknown = requested.filter((pick) => !current.has(pick.stickerId));
    const applicable =
      unknown.length > 0
        ? new Map(
            (await applicableStickersOf(env, row.item_id.trim(), row.bu_id.trim())).map(
              (sticker) => [sticker.id, sticker],
            ),
          )
        : new Map();
    const picks: { stickerId: string; qty: number }[] = [];
    const raised: { stickerId: string; name: string; qtyFrom: number; qtyTo: number }[] = [];
    for (const pick of requested) {
      const existing = current.get(pick.stickerId);
      if (existing && pick.qty < existing.qty) {
        throw validationError('stickers', 'Jumlah stiker tidak boleh diturunkan');
      }
      if (existing && pick.qty > existing.qty && existing.status === 'inactive') {
        throw validationError('stickers', 'Stiker nonaktif tidak dapat ditambah jumlahnya');
      }
      if (!existing && !applicable.has(pick.stickerId)) {
        throw validationError('stickers', 'Stiker tidak berlaku bagi item ini');
      }
      const from = existing?.qty ?? 0;
      if (pick.qty === from) continue;
      const name = existing?.name ?? applicable.get(pick.stickerId)?.name ?? '';
      picks.push({ stickerId: pick.stickerId, qty: pick.qty - from });
      raised.push({ stickerId: pick.stickerId, name, qtyFrom: from, qtyTo: pick.qty });
      changes.push({
        field: 'stickers',
        from: stickerChip(name, existing ? from : null),
        to: stickerChip(name, pick.qty),
      });
      tail.push(upsertSerialStickerStmt(env.DB, serialId, pick.stickerId, pick.qty));
    }
    if (raised.length > 0) {
      data = { ...data, stickers: raised };
      tail.push(
        ...(await statementsFor(env, 'serial.stickers_added', {
          serialId,
          eventId,
          locationId,
          picks,
          actor: user.email,
          now,
        })),
      );
    }
  } else if (input.message.trim() === '') {
    throw validationError('message', 'Catatan wajib diisi');
  }

  statements.push(
    updateSerialStmt(env.DB, {
      id: serialId,
      expectedUpdatedAt: row.updated_at,
      now,
      actorEmail: user.email,
      set,
    }),
    insertNextEventStmt(env.DB, {
      id: eventId,
      serialId,
      caseId: '',
      type: eventType,
      occurredOn: input.occurredOn,
      now,
      actorId: user.userId ?? '',
      actorName: user.name,
      actorTeam: 'qc',
      message: input.message,
      changes,
      data,
    }),
    ...tail,
  );
  await batchGuarded(env.DB, statements, SERIAL_CONFLICTS, STALE_MESSAGE);
  return loadSerialDto(env, user, serialId);
}
