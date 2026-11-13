import { appError } from '@server/core/errors';
import { readObject } from '@server/core/validate';
import type {
  GetSerialInput,
  ListSerialItemOptionsInput,
  SaveSerialBatchInput,
  SerialActInput,
  SerialEditable,
  SerialHistoryInput,
  SerialListInput,
  SerialRowInput,
  SerialStickerOptionsInput,
  SerialStickerPick,
  UpdateSerialBatchInput,
  UpdateSerialBatchRowInput,
  UpdateSerialInput,
} from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { hasBidiControls, hasControlChars } from '@shared/postel';
import {
  isIsoDate,
  listSerialsTooLong,
  normalizeSerial,
  SERIAL_ACTIONS,
  SERIAL_CUSTODIES,
  SERIAL_LIMITS,
  SERIAL_STATUSES,
  type SerialAction,
  type SerialCustody,
  type SerialStatus,
  serialProblem,
} from '@shared/serials';

export const SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT = 20;
export const SERIAL_ITEM_OPTIONS_MAX_LIMIT = 50;
/** Maks. id item pada `serials.itemOptions` mode `itemIds` (GET: ikut URL). */
export const SERIAL_ITEM_IDS_MAX = 50;
export const SERIAL_LIST_DEFAULT_LIMIT = 50;
export const SERIAL_LIST_MAX_LIMIT = 100;

/**
 * Opsi item untuk pencatat: input boleh kosong; `cursor` buram (kunci item terakhir). Bila `itemIds` ada (mode id),
 * `query`, `cursor`, dan `limit` DIABAIKAN sepenuhnya (nilai tak valid pun tidak ditolak), sesuai kontrak.
 */
export function validateListSerialItemOptions(raw: unknown): ListSerialItemOptionsInput {
  const reader = readObject(raw ?? {});
  const itemIdsRaw = reader.raw('itemIds');
  if (itemIdsRaw !== undefined && itemIdsRaw !== null) {
    // `cursor`/`limit`/`query` sengaja tidak dibaca: pada mode id nilainya (valid atau tidak) diabaikan.
    if (
      !Array.isArray(itemIdsRaw) ||
      itemIdsRaw.length > SERIAL_ITEM_IDS_MAX ||
      !itemIdsRaw.every((id) => isText(id, 100))
    ) {
      reader.fail('itemIds', `Maksimal ${SERIAL_ITEM_IDS_MAX} id item yang valid`);
    }
    reader.done();
    return { itemIds: [...new Set(itemIdsRaw as string[])] };
  }
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
  reader.done();
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
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
  if (source.status !== 'good' && source.status !== 'failed') return fail('Status tidak valid');
  // `damage` wajib (satu baris, maks. 200) bila langsung dicatat tidak lolos; pada `good` diabaikan.
  let damage = '';
  if (source.status === 'failed') {
    const text = typeof source.damage === 'string' ? source.damage.trim() : '';
    if (text === '') return fail('Isi dulu kerusakannya');
    if ([...text].length > SERIAL_LIMITS.damageMax || hasControlChars(text)) {
      return fail('Kerusakan tidak valid (satu baris, maks. 200 karakter)');
    }
    damage = text;
  }
  if (
    source.source !== undefined &&
    source.source !== 'manual' &&
    source.source !== 'countrylock'
  ) {
    return fail('Asal catatan tidak valid');
  }
  // `stickers` tidak dikirim = semua stiker yang berlaku (diselesaikan service); `[]` = sengaja tanpa stiker.
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
      status: source.status,
      ...(source.status === 'failed' ? { damage } : {}),
      ...(source.source === undefined ? {} : { source: source.source }),
      ...(source.stickers === undefined ? {} : { stickers }),
    },
  };
}

/** Riwayat per serial: `limit` 1-100 (bawaan 50); kursor = `seq` terakhir (bilangan bulat tak negatif). */
export function validateSerialHistory(raw: unknown): SerialHistoryInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const group = reader.str('group', { max: 16 });
  if (group !== '' && group !== 'all' && group !== 'checks' && group !== 'changes') {
    reader.fail('group', 'Kelompok tidak valid');
  }
  const caseId = reader.str('caseId', { max: 100 });
  const cursor = reader.str('cursor', { max: 12 });
  if (cursor !== '' && !/^\d{1,12}$/.test(cursor)) reader.fail('cursor', 'Kursor tidak valid');
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > SERIAL_LIMITS.historyMaxLimit)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${SERIAL_LIMITS.historyMaxLimit}`);
  }
  reader.done();
  return {
    id,
    ...(group !== '' ? { group: group as SerialHistoryInput['group'] } : {}),
    ...(caseId !== '' ? { caseId } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

export function validateGetSerial(raw: unknown): GetSerialInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

const LIST_STATUS: readonly string[] = SERIAL_STATUSES;
const LIST_CUSTODY: readonly string[] = SERIAL_CUSTODIES;

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
  const custody = reader.str('custody', { max: 16 });
  if (custody !== '' && !LIST_CUSTODY.includes(custody))
    reader.fail('custody', 'Posisi tidak valid');
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
    ...(custody !== '' ? { custody: custody as SerialCustody } : {}),
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

/** Field tambahan yang boleh ada per aksi (selain id, expectedUpdatedAt, action, occurredOn, message). */
const ACT_EXTRA_KEYS: Record<SerialAction, readonly string[]> = {
  note: [],
  attempt_repair: [],
  receive: [],
  declare_broken: [],
  report_failure: ['damage'],
  identify_damage: ['damage'],
  service_diagnosis: ['damage'],
  send: ['toLocationId', 'shipmentNote'],
  recheck: ['result', 'damage', 'locationId', 'stickers'],
  recheck_pass: ['locationId', 'stickers'],
  recheck_fail: ['damage', 'locationId', 'stickers'],
};
const ACT_ALL_EXTRA_KEYS = [
  'damage',
  'toLocationId',
  'shipmentNote',
  'result',
  'locationId',
  'stickers',
] as const;

/**
 * Teks satu baris tanpa karakter kontrol/pengatur arah (kerusakan, catatan pengiriman), dipangkas. Kosong dikembalikan
 * kosong; `required` menandai field wajib dengan `requiredMessage`.
 */
function singleLine(
  reader: ReturnType<typeof readObject>,
  key: string,
  max: number,
  required: boolean,
  requiredMessage: string,
): string {
  const raw = reader.raw(key);
  if (raw === undefined || raw === null) {
    if (required) reader.fail(key, requiredMessage);
    return '';
  }
  if (typeof raw !== 'string') {
    reader.fail(key, 'Harus berupa teks');
    return '';
  }
  const text = raw.trim();
  if (text === '') {
    if (required) reader.fail(key, requiredMessage);
    return '';
  }
  if ([...text].length > max) reader.fail(key, `Maksimal ${max} karakter`);
  else if (hasControlChars(text))
    reader.fail(key, 'Tulis dalam satu baris, tanpa karakter kontrol');
  return text;
}

/**
 * `POST /serials/{id}/act`: semua aksi §5.3. Bentuk salah, field wajib kosong, atau field yang tak berlaku untuk aksi itu
 * (mis. `stickers` pada `send`) = `VALIDATION`. Aturan keadaan dan izin dinilai server sesudahnya (`CONFLICT`/`FORBIDDEN`).
 */
export function validateSerialAct(raw: unknown): SerialActInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { required: true, max: 30 });
  const action = reader.oneOf('action', SERIAL_ACTIONS);
  const occurredOn = reader.str('occurredOn', { required: true, max: 10 });
  if (occurredOn !== '' && !isIsoDate(occurredOn)) reader.fail('occurredOn', 'Tanggal tidak valid');
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const allowed = ACT_EXTRA_KEYS[action];
  for (const key of ACT_ALL_EXTRA_KEYS) {
    const value = source[key];
    if (value === undefined || value === null || allowed.includes(key)) continue;
    reader.fail(
      key,
      key === 'stickers'
        ? 'Stiker hanya untuk cek ulang'
        : 'Field ini tidak berlaku untuk aksi ini',
    );
  }
  const messageRaw = reader.raw('message');
  let message = '';
  if (messageRaw !== undefined && messageRaw !== null) {
    if (typeof messageRaw !== 'string') reader.fail('message', 'Harus berupa teks');
    else if ([...messageRaw].length > SERIAL_LIMITS.messageMax) {
      reader.fail('message', `Maksimal ${SERIAL_LIMITS.messageMax} karakter`);
    } else if (hasBidiControls(messageRaw)) {
      reader.fail('message', 'Catatan memuat karakter pengatur arah teks yang tidak diizinkan');
    } else if (extractFileRefs(messageRaw).length > SERIAL_LIMITS.messageImagesMax) {
      reader.fail('message', `Maksimal ${SERIAL_LIMITS.messageImagesMax} gambar per pesan`);
    } else message = messageRaw;
  }
  if (action === 'note' && message.trim() === '') reader.fail('message', 'Catatan wajib diisi');

  const out: Record<string, unknown> = { id, expectedUpdatedAt, action, occurredOn, message };

  if (action === 'recheck') {
    const resultRaw = source.result;
    if (resultRaw !== undefined && resultRaw !== null) {
      if (resultRaw !== 'pass' && resultRaw !== 'fail') {
        reader.fail('result', 'Hasil harus lolos atau tidak lolos');
      } else out.result = resultRaw;
    }
  }
  if (allowed.includes('damage')) {
    // `recheck`: wajib hanya bila hasilnya tidak lolos (dan tak berlaku bila lolos); `recheck_fail`: opsional.
    const failResult = action === 'recheck' && source.result === 'fail';
    const required =
      action === 'report_failure' ||
      action === 'identify_damage' ||
      action === 'service_diagnosis' ||
      failResult;
    const damage = singleLine(
      reader,
      'damage',
      SERIAL_LIMITS.damageMax,
      required,
      'Isi dulu kerusakannya',
    );
    if (action === 'recheck' && !failResult && damage !== '') {
      reader.fail('damage', 'Kerusakan hanya untuk hasil tidak lolos');
    }
    if (damage !== '') out.damage = damage;
  }
  if (action === 'send') {
    out.toLocationId = reader.str('toLocationId', { required: true, max: 100 });
    out.shipmentNote = singleLine(reader, 'shipmentNote', SERIAL_LIMITS.shipmentNoteMax, false, '');
  }
  if (allowed.includes('locationId')) {
    const locationId = reader.str('locationId', { max: 100 });
    if (locationId !== '') out.locationId = locationId;
  }
  const stickersRaw = source.stickers;
  if (allowed.includes('stickers') && stickersRaw !== undefined && stickersRaw !== null) {
    if (!Array.isArray(stickersRaw) || stickersRaw.length > SERIAL_PICKS_MAX) {
      reader.fail('stickers', 'Daftar stiker tidak valid');
    } else {
      const stickers: SerialStickerPick[] = [];
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
      if (stickers.length > 0) out.stickers = stickers;
    }
  }
  reader.done();
  return out as unknown as SerialActInput;
}
