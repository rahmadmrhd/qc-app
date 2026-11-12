import { appError } from '@server/core/errors';
import { readObject } from '@server/core/validate';
import type {
  GetSerialInput,
  ListSerialItemOptionsInput,
  SaveSerialBatchInput,
  SerialActInput,
  SerialEditable,
  SerialListInput,
  SerialRowInput,
  SerialStickerOptionsInput,
  SerialStickerPick,
  UpdateSerialBatchInput,
  UpdateSerialBatchRowInput,
  UpdateSerialInput,
} from '@shared/contract';
import { hasControlChars } from '@shared/postel';
import {
  isIsoDate,
  listSerialsTooLong,
  normalizeSerial,
  SERIAL_LIMITS,
  SERIAL_STATUSES,
  type SerialStatus,
  serialProblem,
} from '@shared/serials';

export const SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT = 20;
export const SERIAL_ITEM_OPTIONS_MAX_LIMIT = 50;
/** Maks. id item pada `serials.itemOptions` mode `itemIds` (GET: ikut URL). */
export const SERIAL_ITEM_IDS_MAX = 50;
export const SERIAL_LIST_DEFAULT_LIMIT = 50;
export const SERIAL_LIST_MAX_LIMIT = 100;

/** Opsi item untuk pencatat: input boleh kosong; `cursor` buram (kunci item terakhir). */
export function validateListSerialItemOptions(raw: unknown): ListSerialItemOptionsInput {
  const reader = readObject(raw ?? {});
  const cursor = reader.raw('cursor');
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor === '')) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > SERIAL_ITEM_OPTIONS_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${SERIAL_ITEM_OPTIONS_MAX_LIMIT}`);
  }
  const query = reader.str('query', { max: 100 });
  const itemIdsRaw = reader.raw('itemIds');
  let itemIds: string[] | undefined;
  if (itemIdsRaw !== undefined && itemIdsRaw !== null) {
    if (
      !Array.isArray(itemIdsRaw) ||
      itemIdsRaw.length > SERIAL_ITEM_IDS_MAX ||
      !itemIdsRaw.every((id) => isText(id, 100))
    ) {
      reader.fail('itemIds', `Maksimal ${SERIAL_ITEM_IDS_MAX} id item yang valid`);
    } else itemIds = [...new Set(itemIdsRaw as string[])];
  }
  reader.done();
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
    ...(itemIds !== undefined ? { itemIds } : {}),
  };
}

export function validateSerialStickerOptions(raw: unknown): SerialStickerOptionsInput {
  const reader = readObject(raw);
  const itemId = reader.str('itemId', { required: true, max: 100 });
  const buId = reader.str('buId', { required: true, max: 100 });
  reader.done();
  return { itemId, buId };
}

const CLIENT_ID = /^[A-Za-z0-9-]{8,100}$/;
/** Batas pilihan stiker per baris (menjaga muatan terburuk 200 baris di bawah batas badan JSON). */
export const SERIAL_PICKS_MAX = SERIAL_LIMITS.picksMax;

/** Bentuk permintaan saja: setiap baris dinilai sendiri oleh `parseSerialRow` (baris rusak = hasil `invalid`). */
export function validateSaveSerialBatch(raw: unknown): SaveSerialBatchInput {
  const reader = readObject(raw);
  const rows = reader.raw('rows');
  if (!Array.isArray(rows) || rows.length === 0) {
    reader.fail('rows', 'Minimal satu baris');
  } else if (rows.length > SERIAL_LIMITS.batchRows) {
    reader.fail('rows', `Maksimal ${SERIAL_LIMITS.batchRows} baris per permintaan`);
  }
  reader.done();
  if (!Array.isArray(rows)) throw appError('VALIDATION', 'Input tidak valid');
  return { rows: rows as SerialRowInput[] };
}

export type ParsedSerialRow =
  | { ok: true; row: SerialRowInput }
  | { ok: false; clientId: string; message: string };

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;

/** Validasi bentuk satu baris (aturan 1): serial dinormalisasi; tanggal uji tidak boleh di masa depan menurut `today` WIB. */
export function parseSerialRow(raw: unknown, today: string): ParsedSerialRow {
  const source =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const clientId = typeof source.clientId === 'string' ? source.clientId : '';
  const fail = (message: string): ParsedSerialRow => ({ ok: false, clientId, message });
  if (!CLIENT_ID.test(clientId)) return fail('clientId tidak valid');
  if (typeof source.serial !== 'string') return fail('Serial tidak valid');
  const serial = normalizeSerial(source.serial);
  if (serialProblem(serial) !== null) return fail('Serial tidak valid');
  if (!isText(source.itemId, 100) || !isText(source.buId, 100) || !isText(source.locationId, 100)) {
    return fail('Item, BU, atau lokasi tidak valid');
  }
  if (typeof source.testDate !== 'string' || !isIsoDate(source.testDate)) {
    return fail('Tanggal uji tidak valid');
  }
  if (source.testDate > today) return fail('Tanggal uji tidak boleh di masa depan');
  if (typeof source.sample !== 'boolean') return fail('Sample harus true atau false');
  const note = source.note === undefined || source.note === null ? '' : source.note;
  if (
    typeof note !== 'string' ||
    [...note].length > SERIAL_LIMITS.noteMax ||
    hasControlChars(note)
  ) {
    return fail('Catatan tidak valid');
  }
  if (source.status !== 'good') return fail('Status belum didukung');
  const stickersRaw = source.stickers === undefined ? [] : source.stickers;
  if (!Array.isArray(stickersRaw) || stickersRaw.length > SERIAL_PICKS_MAX) {
    return fail('Daftar stiker tidak valid');
  }
  const stickers: SerialRowInput['stickers'] = [];
  const seen = new Set<string>();
  for (const entry of stickersRaw) {
    const pick =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const qty = pick.qty;
    if (
      !isText(pick.stickerId, 100) ||
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > SERIAL_LIMITS.stickerQtyMax
    ) {
      return fail('Daftar stiker tidak valid');
    }
    if (seen.has(pick.stickerId)) return fail('Daftar stiker tidak valid');
    seen.add(pick.stickerId);
    stickers.push({ stickerId: pick.stickerId, qty });
  }
  return {
    ok: true,
    row: {
      clientId,
      serial,
      itemId: source.itemId,
      buId: source.buId,
      testDate: source.testDate,
      locationId: source.locationId,
      sample: source.sample,
      note,
      status: 'good',
      stickers,
    },
  };
}

export function validateGetSerial(raw: unknown): GetSerialInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

const LIST_STATUS: readonly string[] = SERIAL_STATUSES;

/** Daftar serial: semua filter opsional; `limit` 1-100; `serials` maks. `SERIAL_LIMITS.listSerialsMax` serial dan `listSerialsEncodedMax` karakter ter-encode (GET: URL harus muat). */
export function validateSerialList(raw: unknown): SerialListInput {
  const reader = readObject(raw ?? {});
  const query = reader.str('query', { max: 100 });
  const buId = reader.str('buId', { max: 100 });
  const itemId = reader.str('itemId', { max: 100 });
  const locationId = reader.str('locationId', { max: 100 });
  const createdBy = reader.str('createdBy', { max: 255 });
  const status = reader.str('status', { max: 32 });
  if (status !== '' && !LIST_STATUS.includes(status)) reader.fail('status', 'Status tidak valid');
  const from = reader.str('from', { max: 10 });
  if (from !== '' && !isIsoDate(from)) reader.fail('from', 'Tanggal tidak valid');
  const to = reader.str('to', { max: 10 });
  if (to !== '' && !isIsoDate(to)) reader.fail('to', 'Tanggal tidak valid');
  const cursor = reader.str('cursor', { max: 200 });
  const serialsRaw = reader.raw('serials');
  let serials = '';
  if (serialsRaw !== undefined && serialsRaw !== null) {
    if (typeof serialsRaw !== 'string') reader.fail('serials', 'Harus berupa teks');
    else if (
      serialsRaw.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').length >
      SERIAL_LIMITS.listSerialsMax
    ) {
      reader.fail('serials', `Maksimal ${SERIAL_LIMITS.listSerialsMax} serial per pencarian`);
    } else if (listSerialsTooLong(serialsRaw)) {
      reader.fail(
        'serials',
        'Daftar serial terlalu panjang (karakter khusus memakan lebih banyak ruang URL)',
      );
    } else serials = serialsRaw;
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > SERIAL_LIST_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${SERIAL_LIST_MAX_LIMIT}`);
  }
  reader.done();
  return {
    ...(query !== '' ? { query } : {}),
    ...(serials.trim() !== '' ? { serials } : {}),
    ...(buId !== '' ? { buId } : {}),
    ...(itemId !== '' ? { itemId } : {}),
    ...(locationId !== '' ? { locationId } : {}),
    ...(status !== '' ? { status: status as SerialStatus } : {}),
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(createdBy !== '' ? { createdBy } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

export type ParsedEditable =
  | { ok: true; fields: Partial<SerialEditable> }
  | { ok: false; field: string; message: string };

const EDITABLE_KEYS = ['serial', 'itemId', 'testDate', 'sample', 'note', 'locationId'] as const;

/**
 * Bidang yang boleh diubah. `requireAll` (PUT utuh) mewajibkan keenam bidang; selain itu hanya yang ada yang
 * diperiksa (massal). Serial dinormalisasi; tanggal uji tidak boleh di masa depan menurut `today` WIB.
 */
export function parseEditable(
  raw: unknown,
  today: string | undefined,
  requireAll: boolean,
): ParsedEditable {
  const source =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const fields: Partial<SerialEditable> = {};
  for (const key of EDITABLE_KEYS) {
    if (source[key] === undefined) {
      if (requireAll) return { ok: false, field: key, message: 'Wajib diisi' };
      continue;
    }
    const value = source[key];
    if (key === 'serial') {
      if (typeof value !== 'string')
        return { ok: false, field: key, message: 'Serial tidak valid' };
      const serial = normalizeSerial(value);
      if (serialProblem(serial) !== null) {
        return { ok: false, field: key, message: 'Serial tidak valid' };
      }
      fields.serial = serial;
    } else if (key === 'itemId' || key === 'locationId') {
      if (!isText(value, 100)) return { ok: false, field: key, message: 'Tidak valid' };
      fields[key] = value;
    } else if (key === 'testDate') {
      if (typeof value !== 'string' || !isIsoDate(value)) {
        return { ok: false, field: key, message: 'Tanggal uji tidak valid' };
      }
      if (today !== undefined && value > today) {
        return { ok: false, field: key, message: 'Tanggal uji tidak boleh di masa depan' };
      }
      fields.testDate = value;
    } else if (key === 'sample') {
      if (typeof value !== 'boolean') {
        return { ok: false, field: key, message: 'Harus true atau false' };
      }
      fields.sample = value;
    } else {
      if (
        typeof value !== 'string' ||
        [...value].length > SERIAL_LIMITS.noteMax ||
        hasControlChars(value)
      ) {
        return { ok: false, field: key, message: 'Catatan tidak valid' };
      }
      fields.note = value;
    }
  }
  return { ok: true, fields };
}

/** `PUT /serials/{id}`: id, `expectedUpdatedAt`, dan keenam bidang wajib (bentuk saja; tanggal masa depan dinilai service dengan jam server). */
export function validateUpdateSerial(raw: unknown): UpdateSerialInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { required: true, max: 30 });
  const parsed = parseEditable(raw, undefined, true);
  if (!parsed.ok) reader.fail(parsed.field, parsed.message);
  reader.done();
  if (!parsed.ok) throw appError('VALIDATION', 'Input tidak valid');
  return { id, expectedUpdatedAt, ...(parsed.fields as SerialEditable) };
}

/** Bentuk permintaan massal saja: tiap baris dinilai sendiri oleh service (baris rusak = hasil `invalid`). */
export function validateUpdateSerialBatch(raw: unknown): UpdateSerialBatchInput {
  const reader = readObject(raw);
  const rows = reader.raw('rows');
  if (!Array.isArray(rows) || rows.length === 0) {
    reader.fail('rows', 'Minimal satu baris');
  } else if (rows.length > SERIAL_LIMITS.batchRows) {
    reader.fail('rows', `Maksimal ${SERIAL_LIMITS.batchRows} baris per permintaan`);
  }
  reader.done();
  if (!Array.isArray(rows)) throw appError('VALIDATION', 'Input tidak valid');
  return { rows: rows as UpdateSerialBatchRowInput[] };
}

/** `POST /serials/{id}/act`: catatan atau cek ulang; kesalahan bentuk = `VALIDATION`. */
export function validateSerialAct(raw: unknown): SerialActInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { required: true, max: 30 });
  const action = reader.oneOf('action', ['note', 'recheck'] as const);
  const occurredOn = reader.str('occurredOn', { required: true, max: 10 });
  if (occurredOn !== '' && !isIsoDate(occurredOn)) reader.fail('occurredOn', 'Tanggal tidak valid');
  const messageRaw = reader.raw('message');
  let message = '';
  if (messageRaw !== undefined && messageRaw !== null) {
    if (typeof messageRaw !== 'string') reader.fail('message', 'Harus berupa teks');
    else if ([...messageRaw].length > SERIAL_LIMITS.messageMax) {
      reader.fail('message', `Maksimal ${SERIAL_LIMITS.messageMax} karakter`);
    } else message = messageRaw;
  }
  if (action === 'note' && message.trim() === '') reader.fail('message', 'Catatan wajib diisi');
  const locationId = reader.str('locationId', { max: 100 });
  const stickersRaw = reader.raw('stickers');
  const stickers: SerialStickerPick[] = [];
  if (stickersRaw !== undefined && stickersRaw !== null) {
    if (action === 'note') {
      reader.fail('stickers', 'Stiker hanya untuk cek ulang');
    } else if (!Array.isArray(stickersRaw) || stickersRaw.length > SERIAL_PICKS_MAX) {
      reader.fail('stickers', 'Daftar stiker tidak valid');
    } else {
      const seen = new Set<string>();
      for (const entry of stickersRaw) {
        const pick =
          typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
        const qty = pick.qty;
        if (
          !isText(pick.stickerId, 100) ||
          typeof qty !== 'number' ||
          !Number.isInteger(qty) ||
          qty < 1 ||
          qty > SERIAL_LIMITS.stickerQtyMax ||
          seen.has(pick.stickerId)
        ) {
          reader.fail('stickers', 'Daftar stiker tidak valid');
          break;
        }
        seen.add(pick.stickerId);
        stickers.push({ stickerId: pick.stickerId, qty });
      }
    }
  }
  reader.done();
  return {
    id,
    expectedUpdatedAt,
    action,
    occurredOn,
    message,
    ...(locationId !== '' ? { locationId } : {}),
    ...(stickers.length > 0 ? { stickers } : {}),
  };
}
