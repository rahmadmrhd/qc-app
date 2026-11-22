import { normalizeEmail } from '@server/core/email';
import { appError } from '@server/core/errors';
import { readFilterList, readObject } from '@server/core/validate';
import { BATCH_MAX } from '@shared/batch';
import type {
  ApplyStickersBatchInput,
  GetSerialCaseInput,
  GetSerialInput,
  ListSerialItemOptionsInput,
  SaveSerialBatchInput,
  SaveSerialServiceSettingsInput,
  SaveSerialSettingsInput,
  SerialActInput,
  SerialCaseListInput,
  SerialEditable,
  SerialHistoryInput,
  SerialListInput,
  SerialLookupInput,
  SerialLookupManyInput,
  SerialReportNewInput,
  SerialRowInput,
  SerialStickerOptionsInput,
  UpdateSerialBatchInput,
  UpdateSerialBatchRowInput,
  UpdateSerialInput,
} from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { hasBidiControls, hasControlChars, isPostelRecipient } from '@shared/postel';
import {
  isApplyStickersClientId,
  isIsoDate,
  listSerialsTooLong,
  normalizeSerial,
  SERIAL_ACTIONS,
  SERIAL_CUSTODIES,
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  SERIAL_STATUSES,
  SERVICE_DIAGNOSIS_STAGES,
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
  const serialId = reader.str('serialId', { max: 100 });
  reader.done();
  return serialId === '' ? { itemId, buId } : { itemId, buId, serialId };
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

/** Daftar id foto bukti: maks. `perEntryMax`, tiap id teks pendek, tanpa ganda; `null` bila bentuknya tidak sah. */
function readProofPhotoIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > SERIAL_PROOF_LIMITS.perEntryMax) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (!isText(entry, 100) || ids.includes(entry)) return null;
    ids.push(entry);
  }
  return ids;
}

export type ParsedSerialRow =
  | { ok: true; row: SerialRowInput }
  | { ok: false; clientId: string; message: string };

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max;

const NOTE_IMAGE_MESSAGE = 'Catatan tidak boleh memuat gambar.';

/** Catatan serial memakai editor tanpa gambar: rujukan berkas `qcfile:<id>` ditolak (pesan/laporan boleh bergambar). */
const noteHasImages = (note: string): boolean => extractFileRefs(note).length > 0;

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
  if (noteHasImages(note)) return fail(NOTE_IMAGE_MESSAGE);
  // Hanya `good` (laporan rusak 2026-11-14): yang bermasalah dicatat lewat Lapor Rusak. Baris berstatus lain
  // = `invalid` (tanpa `status` boleh); kunci `damage` lama diabaikan.
  if (source.status !== undefined && source.status !== 'good') {
    return fail('Status tidak valid: Serial Number bermasalah dicatat lewat Lapor Rusak');
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
  let proofPhotoIds: string[] | undefined;
  if (source.proofPhotoIds !== undefined && source.proofPhotoIds !== null) {
    const ids = readProofPhotoIds(source.proofPhotoIds);
    if (ids === null) return fail('Daftar foto tidak valid');
    if (ids.length > 0) proofPhotoIds = ids;
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
      ...(source.source === undefined ? {} : { source: source.source }),
      ...(source.stickers === undefined ? {} : { stickers }),
      ...(proofPhotoIds === undefined ? {} : { proofPhotoIds }),
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

/** Detail laporan: `id` laporan wajib. */
export function validateGetSerialCase(raw: unknown): GetSerialCaseInput {
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
  const buIds = readFilterList(reader, 'buIds');
  const itemIds = readFilterList(reader, 'itemIds');
  const locationIds = readFilterList(reader, 'locationIds');
  const statuses = readFilterList(reader, 'statuses', { allowed: LIST_STATUS });
  const custodies = readFilterList(reader, 'custodies', { allowed: LIST_CUSTODY });
  const from = reader.str('from', { max: 10 });
  if (from !== '' && !isIsoDate(from)) reader.fail('from', 'Tanggal tidak valid');
  const to = reader.str('to', { max: 10 });
  if (to !== '' && !isIsoDate(to)) reader.fail('to', 'Tanggal tidak valid');
  const cursor = reader.str('cursor', { max: 200 });
  const deleted = reader.raw('deleted');
  if (deleted !== undefined && deleted !== null && typeof deleted !== 'boolean') {
    reader.fail('deleted', 'Harus berupa true atau false');
  }
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
    ...(buIds ? { buIds } : {}),
    ...(itemIds ? { itemIds } : {}),
    ...(locationIds ? { locationIds } : {}),
    ...(statuses ? { statuses: statuses as SerialStatus[] } : {}),
    ...(custodies ? { custodies: custodies as SerialCustody[] } : {}),
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(createdBy !== '' ? { createdBy } : {}),
    ...(deleted === true ? { deleted: true } : {}),
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
      if (noteHasImages(value)) return { ok: false, field: key, message: NOTE_IMAGE_MESSAGE };
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
  report_failure: [],
  declare_broken: [],
  send: ['toLocationId', 'shipmentNote'],
  receive: ['toLocationId'],
  service_diagnosis: ['stage'],
  recheck: ['result', 'buId', 'stickerIds', 'proofPhotoIds'],
  recheck_pass: ['buId', 'stickerIds', 'proofPhotoIds'],
  recheck_fail: ['stickerIds', 'proofPhotoIds'],
  apply_stickers: ['stickerIds'],
};
const ACT_ALL_EXTRA_KEYS = [
  'toLocationId',
  'shipmentNote',
  'stage',
  'result',
  'buId',
  'stickerIds',
  'proofPhotoIds',
] as const;

const ACT_EXTRA_MESSAGES: Record<string, string> = {
  stickerIds: 'Stiker hanya untuk cek ulang atau tempel stiker',
  proofPhotoIds: 'Foto bukti hanya untuk cek ulang',
  stage: 'Tahap hanya untuk diagnosis',
  toLocationId: 'Lokasi hanya untuk kirim atau terima',
  shipmentNote: 'Catatan pengiriman hanya untuk kirim',
  result: 'Hasil hanya untuk cek ulang',
  buId: 'BU hanya untuk cek ulang yang lolos',
};

/** Catatan wajib per aksi (rancangan §3 butir b): lapor rusak, cek ulang gagal, dan Rusak; juga catatan biasa. */
const MESSAGE_REQUIRED_TEXT: Partial<Record<SerialAction, string>> = {
  note: 'Catatan wajib diisi',
  report_failure: 'Isi dulu catatan laporannya',
  declare_broken: 'Isi dulu catatan untuk menyatakan Rusak',
  recheck_fail: 'Isi dulu catatan hasil gagalnya',
};

/**
 * Catatan pengiriman: teks satu baris tanpa karakter kontrol/pengatur arah, dipangkas; kosong dikembalikan kosong
 * (opsional).
 */
function readShipmentNote(reader: ReturnType<typeof readObject>): string {
  const raw = reader.raw('shipmentNote');
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    reader.fail('shipmentNote', 'Harus berupa teks');
    return '';
  }
  const text = raw.trim();
  if (text === '') return '';
  const max = SERIAL_LIMITS.shipmentNoteMax;
  if ([...text].length > max) reader.fail('shipmentNote', `Maksimal ${max} karakter`);
  else if (hasControlChars(text) || hasBidiControls(text))
    reader.fail('shipmentNote', 'Tulis dalam satu baris, tanpa karakter kontrol');
  return text;
}

/** Pesan kejadian (Markdown): panjang, pengatur arah teks, dan jumlah gambar dibatasi; kosong dikembalikan kosong. */
function readMessage(reader: ReturnType<typeof readObject>): string {
  const messageRaw = reader.raw('message');
  if (messageRaw === undefined || messageRaw === null) return '';
  if (typeof messageRaw !== 'string') {
    reader.fail('message', 'Harus berupa teks');
    return '';
  }
  if ([...messageRaw].length > SERIAL_LIMITS.messageMax) {
    reader.fail('message', `Maksimal ${SERIAL_LIMITS.messageMax} karakter`);
    return '';
  }
  if (hasBidiControls(messageRaw)) {
    reader.fail('message', 'Catatan memuat karakter pengatur arah teks yang tidak diizinkan');
    return '';
  }
  if (extractFileRefs(messageRaw).length > SERIAL_LIMITS.messageImagesMax) {
    reader.fail('message', `Maksimal ${SERIAL_LIMITS.messageImagesMax} gambar per pesan`);
    return '';
  }
  return messageRaw;
}

/**
 * `POST /serials/{id}/act`: semua aksi (rancangan laporan rusak §4.1). Bentuk salah, field wajib kosong, atau field yang
 * tak berlaku untuk aksi itu (mis. `stickerIds` pada `send`) = `VALIDATION`. Aturan keadaan dan izin dinilai server sesudahnya
 * (`CONFLICT`/`FORBIDDEN`).
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
    reader.fail(key, ACT_EXTRA_MESSAGES[key] ?? 'Field ini tidak berlaku untuk aksi ini');
  }
  const message = readMessage(reader);
  // Wajib bila aksinya mewajibkan, atau cek ulang `fail` (hasil gagal membuka laporan).
  const requiredText =
    action === 'recheck' && source.result === 'fail'
      ? 'Isi dulu catatan hasil gagalnya'
      : MESSAGE_REQUIRED_TEXT[action];
  if (requiredText !== undefined && message.trim() === '') reader.fail('message', requiredText);

  const out: Record<string, unknown> = { id, expectedUpdatedAt, action, occurredOn, message };

  if (action === 'recheck') {
    const resultRaw = source.result;
    if (resultRaw !== undefined && resultRaw !== null) {
      if (resultRaw !== 'pass' && resultRaw !== 'fail') {
        reader.fail('result', 'Hasil harus lolos atau gagal');
      } else out.result = resultRaw;
    }
  }
  if (allowed.includes('buId')) {
    // Memindahkan BU hanya pada cek ulang yang lolos; hasil gagal menolaknya.
    const rawBu = source.buId;
    if (action === 'recheck' && source.result === 'fail' && rawBu != null && rawBu !== '') {
      reader.fail('buId', ACT_EXTRA_MESSAGES.buId ?? '');
    } else {
      const buId = reader.str('buId', { max: 100 });
      if (buId !== '') out.buId = buId;
    }
  }
  if (action === 'service_diagnosis') {
    out.stage = reader.oneOf('stage', SERVICE_DIAGNOSIS_STAGES);
  }
  if (allowed.includes('toLocationId')) {
    const toLocationId = reader.str('toLocationId', { max: 100 });
    if (toLocationId !== '') out.toLocationId = toLocationId;
  }
  if (allowed.includes('shipmentNote')) {
    const shipmentNote = readShipmentNote(reader);
    if (shipmentNote !== '') out.shipmentNote = shipmentNote;
  }
  const stickerIdsRaw = source.stickerIds;
  if (allowed.includes('stickerIds') && stickerIdsRaw !== undefined && stickerIdsRaw !== null) {
    if (!Array.isArray(stickerIdsRaw) || stickerIdsRaw.length > SERIAL_PICKS_MAX) {
      reader.fail('stickerIds', 'Daftar stiker tidak valid');
    } else {
      const stickerIds: string[] = [];
      const seen = new Set<string>();
      for (const entry of stickerIdsRaw) {
        if (!isText(entry, 100) || seen.has(entry)) {
          reader.fail('stickerIds', 'Daftar stiker tidak valid');
          break;
        }
        seen.add(entry);
        stickerIds.push(entry);
      }
      if (stickerIds.length > 0) out.stickerIds = stickerIds;
    }
  }
  // Tempel stiker: minimal satu stiker (tanpa stiker = tidak ada yang ditempel).
  if (action === 'apply_stickers' && out.stickerIds === undefined) {
    reader.fail('stickerIds', 'Pilih minimal satu stiker');
  }
  const proofRaw = source.proofPhotoIds;
  if (allowed.includes('proofPhotoIds') && proofRaw !== undefined && proofRaw !== null) {
    const proofPhotoIds = readProofPhotoIds(proofRaw);
    if (proofPhotoIds === null) reader.fail('proofPhotoIds', 'Daftar foto tidak valid');
    else if (proofPhotoIds.length > 0) out.proofPhotoIds = proofPhotoIds;
  }
  reader.done();
  return out as unknown as SerialActInput;
}

/** Panjang id serial maks. pada Tempel stiker massal: `client_id` kejadian = `<clientId 36>:<id>` harus muat di VARCHAR(100). */
const APPLY_STICKERS_ID_MAX = 60;

/**
 * `POST /serials/batch/stickers` (keputusan pemilik 2026-11-22, K2): `clientId` UUID huruf kecil, tanggal kejadian,
 * catatan opsional TANPA gambar (satu catatan dipakai semua baris; klaim berkas per serial tak berlaku), dan 1..`BATCH_MAX`
 * baris `{ id, stickerIds }` dengan id unik dan tiap baris minimal satu stiker unik (maks. `SERIAL_PICKS_MAX`).
 */
export function validateApplyStickersBatch(raw: unknown): ApplyStickersBatchInput {
  const reader = readObject(raw);
  const clientId = reader.str('clientId', { required: true, max: 36 });
  if (clientId !== '' && !isApplyStickersClientId(clientId)) {
    reader.fail('clientId', 'Pengenal permintaan tidak valid');
  }
  const occurredOn = reader.str('occurredOn', { required: true, max: 10 });
  if (occurredOn !== '' && !isIsoDate(occurredOn)) reader.fail('occurredOn', 'Tanggal tidak valid');
  const message = readMessage(reader);
  if (message !== '' && extractFileRefs(message).length > 0) {
    reader.fail('message', 'Catatan massal tidak boleh memuat gambar');
  }
  const rowsRaw = reader.raw('rows');
  const rows: ApplyStickersBatchInput['rows'] = [];
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    reader.fail('rows', 'Minimal satu baris');
  } else if (rowsRaw.length > BATCH_MAX) {
    reader.fail('rows', `Maksimal ${BATCH_MAX} baris per permintaan`);
  } else {
    const seen = new Set<string>();
    for (const entry of rowsRaw) {
      const source =
        typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
      const id = source.id;
      const stickers = source.stickerIds;
      if (
        typeof id !== 'string' ||
        id === '' ||
        id.length > APPLY_STICKERS_ID_MAX ||
        seen.has(id) ||
        !Array.isArray(stickers) ||
        stickers.length === 0 ||
        stickers.length > SERIAL_PICKS_MAX ||
        !stickers.every((stickerId) => isText(stickerId, 100)) ||
        new Set(stickers).size !== stickers.length
      ) {
        reader.fail('rows', 'Baris tidak valid');
        break;
      }
      seen.add(id);
      rows.push({ id, stickerIds: stickers as string[] });
    }
  }
  reader.done();
  return { clientId, occurredOn, message, rows };
}

/**
 * Pengaturan surel Serial Number rusak: `expectedUpdatedAt` boleh kosong (penyimpanan pertama); penerima maks.
 * `alertRecipientsMax`, tiap entri SATU alamat polos (`isPostelRecipient`, tanpa beda huruf besar/kecil), tanpa ganda.
 */
export function validateSaveSerialSettings(raw: unknown): SaveSerialSettingsInput {
  const reader = readObject(raw);
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt') ?? '';
  const value = reader.raw('alert');
  const recipients: string[] = [];
  let enabled = false;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reader.fail('alert', 'Pengaturan peringatan harus berupa objek');
  } else {
    const source = value as Record<string, unknown>;
    if (typeof source.enabled !== 'boolean')
      reader.fail('enabled', 'Sakelar harus true atau false');
    enabled = source.enabled === true;
    if (!Array.isArray(source.recipients)) {
      reader.fail('recipients', 'Penerima harus berupa daftar email');
    } else if (source.recipients.length > SERIAL_LIMITS.alertRecipientsMax) {
      reader.fail('recipients', `Maksimal ${SERIAL_LIMITS.alertRecipientsMax} penerima`);
    } else {
      const seen = new Set<string>();
      for (const item of source.recipients) {
        const email = typeof item === 'string' ? normalizeEmail(item) : '';
        if (!isPostelRecipient(email)) {
          reader.fail('recipients', 'Ada alamat email yang tidak valid');
          break;
        }
        if (seen.has(email)) {
          reader.fail('recipients', `Email ganda: ${email}`);
          break;
        }
        seen.add(email);
        recipients.push(email);
      }
    }
  }
  reader.done();
  return { expectedUpdatedAt, alert: { enabled, recipients } };
}

/** Maks. lokasi pada konfigurasi lokasi tim servis (jauh di atas jumlah lokasi nyata). */
export const SERVICE_LOCATIONS_MAX = 500;

/** Konfigurasi lokasi servis: `expectedUpdatedAt` boleh kosong (simpan pertama); id lokasi unik; kosong = semua lokasi aktif. */
export function validateSaveSerialServiceSettings(raw: unknown): SaveSerialServiceSettingsInput {
  const reader = readObject(raw);
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt') ?? '';
  const value = reader.raw('locationIds');
  const locationIds: string[] = [];
  if (!Array.isArray(value)) {
    reader.fail('locationIds', 'Lokasi harus berupa daftar');
  } else if (value.length > SERVICE_LOCATIONS_MAX) {
    reader.fail('locationIds', `Maksimal ${SERVICE_LOCATIONS_MAX} lokasi`);
  } else {
    const seen = new Set<string>();
    for (const entry of value) {
      if (!isText(entry, 100)) {
        reader.fail('locationIds', 'Ada lokasi yang tidak valid');
        break;
      }
      const id = entry.trim();
      if (seen.has(id)) {
        reader.fail('locationIds', 'Ada lokasi yang ganda');
        break;
      }
      seen.add(id);
      locationIds.push(id);
    }
  }
  reader.done();
  return { expectedUpdatedAt, locationIds };
}

/** Pencarian Serial Number untuk Lapor Rusak: serial dinormalisasi (MAC menjadi satu bentuk); bentuk tak sah = VALIDATION. */
export function validateSerialLookup(raw: unknown): SerialLookupInput {
  const reader = readObject(raw);
  const text = reader.str('serial', { required: true, max: 100 });
  const serial = normalizeSerial(text);
  if (text !== '' && serialProblem(serial) !== null) reader.fail('serial', 'Serial tidak valid');
  reader.done();
  return { serial };
}

/**
 * Pencarian banyak serial untuk draft Catat: tiap entri dinormalisasi, yang tak sah dan yang ganda dibuang diam-diam
 * (draft sudah menyaringnya); maks. `SERIAL_LIMITS.batchRows` serial.
 */
export function validateSerialLookupMany(raw: unknown): SerialLookupManyInput {
  const reader = readObject(raw);
  const list = reader.raw('serials');
  if (!Array.isArray(list)) {
    reader.fail('serials', 'Daftar serial wajib');
  } else if (list.length > SERIAL_LIMITS.batchRows) {
    reader.fail('serials', `Maksimal ${SERIAL_LIMITS.batchRows} serial per permintaan`);
  }
  reader.done();
  const serials: string[] = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (typeof entry !== 'string' || entry.length > 100) continue;
      const serial = normalizeSerial(entry);
      if (serialProblem(serial) === null && !serials.includes(serial)) serials.push(serial);
    }
  }
  return { serials };
}

/** Lapor Rusak untuk Serial Number yang belum tercatat: semua field wajib; catatan wajib (Markdown, gambar maks. 10). */
export function validateSerialReportNew(raw: unknown): SerialReportNewInput {
  const reader = readObject(raw);
  const text = reader.str('serial', { required: true, max: 100 });
  const serial = normalizeSerial(text);
  if (text !== '' && serialProblem(serial) !== null) reader.fail('serial', 'Serial tidak valid');
  const itemId = reader.str('itemId', { required: true, max: 100 });
  const buId = reader.str('buId', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const occurredOn = reader.str('occurredOn', { required: true, max: 10 });
  if (occurredOn !== '' && !isIsoDate(occurredOn)) reader.fail('occurredOn', 'Tanggal tidak valid');
  const message = readMessage(reader);
  if (message.trim() === '') reader.fail('message', 'Isi dulu catatan laporannya');
  reader.done();
  return { serial, itemId, buId, locationId, message, occurredOn };
}

/** Daftar Laporan: semua filter opsional; `status` `active`/`closed`; `limit` 1-100; kursor = `created_at|number`. */
export function validateSerialCaseList(raw: unknown): SerialCaseListInput {
  const reader = readObject(raw ?? {});
  const status = reader.str('status', { max: 16 });
  if (status !== '' && status !== 'active' && status !== 'closed') {
    reader.fail('status', 'Status laporan tidak valid');
  }
  const buId = reader.str('buId', { max: 100 });
  const buIds = readFilterList(reader, 'buIds');
  const query = reader.str('query', { max: 100 });
  const cursor = reader.str('cursor', { max: 100 });
  if (cursor !== '' && !/^[^|]+\|[^|]+$/.test(cursor)) reader.fail('cursor', 'Kursor tidak valid');
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
    ...(status !== '' ? { status: status as SerialCaseListInput['status'] } : {}),
    ...(buId !== '' ? { buId } : {}),
    ...(buIds ? { buIds } : {}),
    ...(query !== '' ? { query } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}
