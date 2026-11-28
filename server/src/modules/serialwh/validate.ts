import { appError } from '@server/core/errors';
import { readFilterList, readObject } from '@server/core/validate';
import type {
  GetWarehouseDispatchInput,
  GetWarehouseOrderInput,
  GetWarehouseReadyInput,
  ListWarehouseDispatchesInput,
  ListWarehouseDispatchSerialsInput,
  ListWarehouseItemOptionsInput,
  ListWarehouseOrderOptionsInput,
  ListWarehouseOrdersInput,
  ListWarehouseReadyInput,
  ListWarehouseSerialsInput,
  SerialStickerPick,
  UpdateWarehouseDispatchInput,
  WarehouseCopyTextInput,
  WarehouseLookupInput,
  WarehouseSubmitHeader,
  WarehouseSubmitInput,
  WarehouseSubmitRow,
} from '@shared/contract';
import { customerNameProblem } from '@shared/handover';
import { hasControlChars } from '@shared/postel';
import {
  chunkCountOf,
  chunkRowsOf,
  normalizeOrderNumber,
  orderNumberProblem,
  WAREHOUSE_BOX_LIMITS,
  WAREHOUSE_LIMITS,
  type WarehouseDispatchStatus,
} from '@shared/serial-warehouse';
import { isIsoDate, normalizeSerial, SERIAL_LIMITS, serialProblem } from '@shared/serials';

/** `clientId` pengeluaran dan baris serial baru: UUID huruf kecil. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Obj = Record<string, unknown>;

/** Karakter kontrol selain baris baru dan tab, atau pengatur arah teks (bidi). */
function hasNoteControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x200e || code === 0x200f) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value !== '' && value.length <= max;

function invalid(field: string, message: string): never {
  throw appError('VALIDATION', message, { [field]: message });
}

/** Halaman: `limit` bilangan bulat 1..max (tiada = bawaan pemanggil). */
function readLimit(reader: ReturnType<typeof readObject>, max: number): number | undefined {
  const limit = reader.raw('limit');
  if (limit === undefined || limit === null) return undefined;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > max) {
    reader.fail('limit', `Batas halaman harus 1-${max}`);
    return undefined;
  }
  return limit;
}

export function validateWarehouseItemOptions(raw: unknown): ListWarehouseItemOptionsInput {
  const reader = readObject(raw ?? {});
  const query = reader.str('query', { max: 100 });
  const buId = reader.str('buId', { max: 100 });
  const cursor = reader.str('cursor', { max: 200 });
  const ids = readFilterList(reader, 'ids');
  if (ids && ids.length > WAREHOUSE_LIMITS.itemOptionsMax) reader.fail('ids', 'Terlalu banyak id');
  const limit = readLimit(reader, WAREHOUSE_LIMITS.itemOptionsMax);
  reader.done();
  return {
    ...(query !== '' ? { query } : {}),
    ...(buId !== '' ? { buId } : {}),
    ...(ids ? { ids } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function validateWarehouseSerials(raw: unknown): ListWarehouseSerialsInput {
  const reader = readObject(raw ?? {});
  const itemId = reader.str('itemId', { required: true, max: 100 });
  const buIds = readFilterList(reader, 'buIds');
  const locationId = reader.str('locationId', { max: 100 });
  const testDate = reader.str('testDate', { max: 10 });
  if (testDate !== '' && !isIsoDate(testDate)) reader.fail('testDate', 'Tanggal tidak valid');
  const query = reader.str('query', { max: 100 });
  const hideRecordedBuId = reader.str('hideRecordedBuId', { max: 100 });
  const forMode = reader.str('forMode', { max: 10 });
  if (forMode !== '' && forMode !== 'order' && forMode !== 'ready' && forMode !== 'note') {
    reader.fail('forMode', 'Mode tidak valid');
  }
  const cursor = reader.str('cursor', { max: 200 });
  const limit = readLimit(reader, WAREHOUSE_LIMITS.listMax);
  reader.done();
  return {
    itemId,
    ...(buIds ? { buIds } : {}),
    ...(locationId !== '' ? { locationId } : {}),
    ...(testDate !== '' ? { testDate } : {}),
    ...(query !== '' ? { query } : {}),
    ...(hideRecordedBuId !== '' ? { hideRecordedBuId } : {}),
    ...(forMode === 'order' || forMode === 'ready' || forMode === 'note' ? { forMode } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function stringList(
  reader: ReturnType<typeof readObject>,
  key: string,
  max: number,
): string[] | undefined {
  const value = reader.raw(key);
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > max ||
    !value.every((item) => typeof item === 'string' && item !== '' && item.length <= 200)
  ) {
    reader.fail(key, 'Daftar tidak valid');
    return undefined;
  }
  return value as string[];
}

export function validateWarehouseLookup(raw: unknown): WarehouseLookupInput {
  const reader = readObject(raw ?? {});
  const serials = stringList(reader, 'serials', WAREHOUSE_LIMITS.lookupMax);
  const ids = stringList(reader, 'ids', WAREHOUSE_LIMITS.lookupMax);
  const orderId = reader.str('orderId', { max: 100 });
  if ((serials?.length ?? 0) + (ids?.length ?? 0) > WAREHOUSE_LIMITS.lookupMax) {
    reader.fail('serials', `Maksimal ${WAREHOUSE_LIMITS.lookupMax} serial per pencarian`);
  }
  reader.done();
  return {
    ...(serials ? { serials } : {}),
    ...(ids ? { ids } : {}),
    ...(orderId !== '' ? { orderId } : {}),
  };
}

export function validateWarehouseOrderOptions(raw: unknown): ListWarehouseOrderOptionsInput {
  const reader = readObject(raw ?? {});
  const query = reader.str('query', { max: 100 });
  const buId = reader.str('buId', { max: 100 });
  const cursor = reader.str('cursor', { max: 200 });
  const ids = readFilterList(reader, 'ids');
  if (ids && ids.length > WAREHOUSE_LIMITS.itemOptionsMax) reader.fail('ids', 'Terlalu banyak id');
  const limit = readLimit(reader, WAREHOUSE_LIMITS.itemOptionsMax);
  reader.done();
  return {
    ...(query !== '' ? { query } : {}),
    ...(buId !== '' ? { buId } : {}),
    ...(ids ? { ids } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function parseHeader(raw: unknown): WarehouseSubmitHeader {
  if (!isObj(raw)) return invalid('header', 'Header tidak valid');
  if (typeof raw.dispatchedOn !== 'string' || !isIsoDate(raw.dispatchedOn)) {
    return invalid('dispatchedOn', 'Tanggal keluar tidak valid');
  }
  const modeRaw = raw.mode;
  if (
    modeRaw !== undefined &&
    modeRaw !== null &&
    modeRaw !== 'order' &&
    modeRaw !== 'ready' &&
    modeRaw !== 'note'
  ) {
    return invalid('mode', 'Mode tidak valid');
  }
  const note = modeRaw === 'note';
  // `ready` dan `note` sama-sama tanpa SO/customer dan memakai nomor kardus; beda: `note` boleh menaut task dan memuat Markdown.
  const ready = modeRaw === 'ready' || note;
  let orderNumber = '';
  if (ready) {
    // Catat ready tidak punya SO: isian SO/customer/task ditolak bila terisi (kosong/tiada diterima).
    if (raw.orderId !== undefined && raw.orderId !== null && raw.orderId !== '') {
      return invalid('orderId', 'Catat ready tidak memakai SO');
    }
    if (raw.orderNumber !== undefined && raw.orderNumber !== null && raw.orderNumber !== '') {
      return invalid('orderNumber', 'Catat ready tidak memakai No SO');
    }
  } else {
    if (typeof raw.orderNumber !== 'string') return invalid('orderNumber', 'No SO tidak valid');
    orderNumber = normalizeOrderNumber(raw.orderNumber);
    // No SO kosong = Penjualan tanpa SO (tanpa catatan SO, tanpa `orderId`).
    const problem = orderNumber === '' ? null : orderNumberProblem(orderNumber);
    if (
      orderNumber === '' &&
      raw.orderId !== undefined &&
      raw.orderId !== null &&
      raw.orderId !== ''
    ) {
      return invalid('orderId', 'Tanpa No SO tidak memakai catatan SO');
    }
    if (problem !== null) {
      return invalid(
        'orderNumber',
        problem === 'empty'
          ? 'No SO wajib diisi'
          : problem === 'too_long'
            ? `No SO maksimal ${WAREHOUSE_LIMITS.orderNumberMax} karakter`
            : 'No SO tidak valid',
      );
    }
    if (raw.orderId !== undefined && raw.orderId !== null && !isText(raw.orderId, 100)) {
      return invalid('orderId', 'ID SO tidak valid');
    }
  }
  if (!isText(raw.buId, 100)) return invalid('buId', 'BU tidak valid');
  const customerName = typeof raw.customerName === 'string' ? raw.customerName.trim() : '';
  if (ready) {
    if (
      raw.customerName !== undefined &&
      raw.customerName !== null &&
      (typeof raw.customerName !== 'string' || customerName !== '')
    ) {
      return invalid('customerName', 'Catat ready tidak memakai customer');
    }
  } else {
    if (typeof raw.customerName !== 'string') {
      return invalid('customerName', 'Customer tidak valid');
    }
    // Tanpa No SO customer opsional (hanya penyaring task); dengan No SO tetap wajib.
    const customerProblem =
      orderNumber === '' && customerName === '' ? null : customerNameProblem(customerName);
    if (customerProblem !== null) return invalid('customerName', customerProblem);
  }
  if (!isText(raw.itemId, 100)) return invalid('itemId', 'Item tidak valid');
  const noteText = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (
    typeof raw.note !== 'string' ||
    [...noteText].length > WAREHOUSE_LIMITS.noteMax ||
    // Mode catatan berisi Markdown: baris baru dan tab sah, karakter kontrol lain dan pengatur arah teks tidak.
    (note ? hasNoteControlChars(noteText) : hasControlChars(noteText))
  ) {
    return invalid('note', 'Catatan tidak valid');
  }
  const handoverIds = ready && raw.handoverIds === undefined ? [] : raw.handoverIds;
  if (!note && ready && Array.isArray(handoverIds) && handoverIds.length > 0) {
    return invalid('handoverIds', 'Catat ready tidak memakai task Serah Terima');
  }
  if (
    !Array.isArray(handoverIds) ||
    handoverIds.length > WAREHOUSE_LIMITS.handoverLinksMax ||
    !handoverIds.every((id) => isText(id, 100)) ||
    new Set(handoverIds).size !== handoverIds.length
  ) {
    return invalid('handoverIds', 'Daftar task tidak valid');
  }
  const total = raw.total;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 1) {
    return invalid('total', 'Jumlah serial tidak valid');
  }
  const chunkSize = raw.chunkSize;
  if (
    typeof chunkSize !== 'number' ||
    !Number.isInteger(chunkSize) ||
    chunkSize < 1 ||
    chunkSize > WAREHOUSE_LIMITS.chunkMax
  ) {
    return invalid('chunkSize', `Ukuran potongan harus 1-${WAREHOUSE_LIMITS.chunkMax}`);
  }
  // Nomor kardus pertama dan pcs per kardus: wajib bersama pada ready, ditolak pada mode SO.
  let box: { boxStart: number; boxSize: number } | null = null;
  if (ready) {
    const { boxStart, boxSize } = raw;
    if (
      typeof boxStart !== 'number' ||
      !Number.isInteger(boxStart) ||
      boxStart < 1 ||
      boxStart > WAREHOUSE_BOX_LIMITS.numberMax
    ) {
      return invalid('boxStart', `Nomor kardus harus 1-${WAREHOUSE_BOX_LIMITS.numberMax}`);
    }
    if (
      typeof boxSize !== 'number' ||
      !Number.isInteger(boxSize) ||
      boxSize < 1 ||
      boxSize > WAREHOUSE_BOX_LIMITS.sizeMax
    ) {
      return invalid('boxSize', `Pcs per kardus harus 1-${WAREHOUSE_BOX_LIMITS.sizeMax}`);
    }
    box = { boxStart, boxSize };
  } else {
    if (raw.boxStart !== undefined && raw.boxStart !== null) {
      return invalid('boxStart', 'Hanya untuk catat ready');
    }
    if (raw.boxSize !== undefined && raw.boxSize !== null) {
      return invalid('boxSize', 'Hanya untuk catat ready');
    }
  }
  let locationId: string | undefined;
  if (raw.locationId !== undefined && raw.locationId !== null) {
    if (typeof raw.locationId !== 'string' || raw.locationId.length > 100) {
      return invalid('locationId', 'Lokasi tidak valid');
    }
    if (raw.locationId !== '') locationId = raw.locationId;
  }
  let stickers: SerialStickerPick[] | undefined;
  if (raw.stickers !== undefined && raw.stickers !== null) {
    if (!Array.isArray(raw.stickers) || raw.stickers.length > SERIAL_LIMITS.picksMax) {
      return invalid('stickers', 'Daftar stiker tidak valid');
    }
    const seenStickers = new Set<string>();
    stickers = [];
    for (const entry of raw.stickers) {
      if (
        !isObj(entry) ||
        !isText(entry.stickerId, 100) ||
        typeof entry.qty !== 'number' ||
        !Number.isInteger(entry.qty) ||
        entry.qty < 1 ||
        entry.qty > SERIAL_LIMITS.stickerQtyMax
      ) {
        return invalid('stickers', 'Pilihan stiker tidak valid');
      }
      if (seenStickers.has(entry.stickerId)) {
        return invalid('stickers', 'Stiker tidak boleh ganda');
      }
      seenStickers.add(entry.stickerId);
      stickers.push({ stickerId: entry.stickerId, qty: entry.qty });
    }
  }
  return {
    ...(ready ? { mode: note ? ('note' as const) : ('ready' as const) } : {}),
    ...(box ?? {}),
    ...(locationId !== undefined ? { locationId } : {}),
    ...(stickers !== undefined ? { stickers } : {}),
    dispatchedOn: raw.dispatchedOn,
    ...(!ready && typeof raw.orderId === 'string' && raw.orderId !== ''
      ? { orderId: raw.orderId }
      : {}),
    orderNumber,
    buId: raw.buId,
    customerName,
    itemId: raw.itemId,
    note: noteText,
    handoverIds: [...handoverIds] as string[],
    total,
    chunkSize,
  };
}

function parseRow(raw: unknown, index: number): WarehouseSubmitRow {
  const field = `rows.${index}`;
  if (!isObj(raw)) return invalid(field, 'Baris tidak valid');
  if (typeof raw.serial !== 'string') return invalid(field, 'Serial tidak valid');
  const serial = normalizeSerial(raw.serial);
  if (serialProblem(serial) !== null) return invalid(field, 'Serial tidak valid');
  if (raw.kind === 'existing') {
    if (!isText(raw.serialId, 100)) return invalid(field, 'Serial tidak valid');
    return { kind: 'existing', serialId: raw.serialId, serial };
  }
  if (raw.kind === 'new') {
    if (typeof raw.clientId !== 'string' || !UUID.test(raw.clientId)) {
      return invalid(field, 'clientId tidak valid');
    }
    if (!isText(raw.locationId, 100)) return invalid(field, 'Lokasi tidak valid');
    if (typeof raw.testDate !== 'string' || !isIsoDate(raw.testDate)) {
      return invalid(field, 'Tanggal uji tidak valid');
    }
    return {
      kind: 'new',
      clientId: raw.clientId,
      serial,
      locationId: raw.locationId,
      testDate: raw.testDate,
    };
  }
  return invalid(field, 'Jenis baris tidak valid');
}

export function validateWarehouseSubmit(raw: unknown): WarehouseSubmitInput {
  if (!isObj(raw)) return invalid('_', 'Input harus berupa objek');
  if (typeof raw.clientId !== 'string' || !UUID.test(raw.clientId)) {
    return invalid('clientId', 'clientId tidak valid');
  }
  const header = parseHeader(raw.header);
  const chunkIndex = raw.chunkIndex;
  if (
    typeof chunkIndex !== 'number' ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    chunkIndex >= chunkCountOf(header.total, header.chunkSize)
  ) {
    return invalid('chunkIndex', 'Nomor potongan tidak valid');
  }
  const rowsRaw = raw.rows;
  const expected = chunkRowsOf(header.total, header.chunkSize, chunkIndex);
  if (!Array.isArray(rowsRaw) || rowsRaw.length !== expected) {
    return invalid('rows', 'Jumlah baris tidak sesuai potongan');
  }
  const rows = rowsRaw.map((row, index) => parseRow(row, index));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.serial)) return invalid('rows', `Serial dobel: ${row.serial}`);
    seen.add(row.serial);
  }
  return { clientId: raw.clientId, chunkIndex, header, rows };
}

export function validateWarehouseDispatchSerials(raw: unknown): ListWarehouseDispatchSerialsInput {
  const reader = readObject(raw ?? {});
  const id = reader.str('id', { required: true, max: 100 });
  const cursor = reader.str('cursor', { max: 200 });
  const limit = readLimit(reader, WAREHOUSE_LIMITS.dispatchSerialsMax);
  reader.done();
  return {
    id,
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function validateWarehouseCopyText(raw: unknown): WarehouseCopyTextInput {
  const reader = readObject(raw ?? {});
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateWarehouseListOrders(raw: unknown): ListWarehouseOrdersInput {
  const reader = readObject(raw ?? {});
  const query = reader.str('query', { max: 100 });
  const customerIds = readFilterList(reader, 'customerIds');
  const buIds = readFilterList(reader, 'buIds');
  const from = reader.str('from', { max: 10 });
  if (from !== '' && !isIsoDate(from)) reader.fail('from', 'Tanggal tidak valid');
  const to = reader.str('to', { max: 10 });
  if (to !== '' && !isIsoDate(to)) reader.fail('to', 'Tanggal tidak valid');
  const status = reader.str('status', { max: 10 });
  if (status !== '' && status !== 'pending' && status !== 'done') {
    reader.fail('status', 'Status tidak valid');
  }
  const cursor = reader.str('cursor', { max: 200 });
  const limit = readLimit(reader, WAREHOUSE_LIMITS.listMax);
  reader.done();
  return {
    ...(query !== '' ? { query } : {}),
    ...(customerIds ? { customerIds } : {}),
    ...(buIds ? { buIds } : {}),
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(status === 'pending' || status === 'done' ? { status } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

const DISPATCH_STATUSES: readonly string[] = ['pending', 'done', 'cancelled'];

export function validateWarehouseListReady(raw: unknown): ListWarehouseReadyInput {
  const reader = readObject(raw ?? {});
  const buIds = readFilterList(reader, 'buIds');
  const from = reader.str('from', { max: 10 });
  if (from !== '' && !isIsoDate(from)) reader.fail('from', 'Tanggal tidak valid');
  const to = reader.str('to', { max: 10 });
  if (to !== '' && !isIsoDate(to)) reader.fail('to', 'Tanggal tidak valid');
  const status = reader.str('status', { max: 10 });
  if (status !== '' && !DISPATCH_STATUSES.includes(status)) {
    reader.fail('status', 'Status tidak valid');
  }
  const cursor = reader.str('cursor', { max: 200 });
  const limit = readLimit(reader, WAREHOUSE_LIMITS.listMax);
  reader.done();
  return {
    ...(buIds ? { buIds } : {}),
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(status !== '' ? { status: status as WarehouseDispatchStatus } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function validateWarehouseListDispatches(raw: unknown): ListWarehouseDispatchesInput {
  const reader = readObject(raw ?? {});
  const query = reader.str('query', { max: 100 });
  const kind = reader.str('kind', { max: 10 });
  if (kind !== '' && kind !== 'order' && kind !== 'ready' && kind !== 'note') {
    reader.fail('kind', 'Jenis tidak valid');
  }
  const customerIds = readFilterList(reader, 'customerIds');
  const itemIds = readFilterList(reader, 'itemIds');
  const buIds = readFilterList(reader, 'buIds');
  const from = reader.str('from', { max: 10 });
  if (from !== '' && !isIsoDate(from)) reader.fail('from', 'Tanggal tidak valid');
  const to = reader.str('to', { max: 10 });
  if (to !== '' && !isIsoDate(to)) reader.fail('to', 'Tanggal tidak valid');
  const status = reader.str('status', { max: 10 });
  if (status !== '' && !DISPATCH_STATUSES.includes(status)) {
    reader.fail('status', 'Status tidak valid');
  }
  const cursor = reader.str('cursor', { max: 200 });
  const limit = readLimit(reader, WAREHOUSE_LIMITS.listMax);
  reader.done();
  return {
    ...(query !== '' ? { query } : {}),
    ...(kind === 'order' || kind === 'ready' || kind === 'note' ? { kind } : {}),
    ...(customerIds ? { customerIds } : {}),
    ...(itemIds ? { itemIds } : {}),
    ...(buIds ? { buIds } : {}),
    ...(from !== '' ? { from } : {}),
    ...(to !== '' ? { to } : {}),
    ...(status !== '' ? { status: status as WarehouseDispatchStatus } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function validateWarehouseGetDispatch(raw: unknown): GetWarehouseDispatchInput {
  const reader = readObject(raw ?? {});
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateWarehouseGetReady(raw: unknown): GetWarehouseReadyInput {
  const reader = readObject(raw ?? {});
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateWarehouseGetOrder(raw: unknown): GetWarehouseOrderInput {
  const reader = readObject(raw ?? {});
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateWarehouseUpdateDispatch(raw: unknown): UpdateWarehouseDispatchInput {
  if (!isObj(raw)) return invalid('_', 'Input harus berupa objek');
  if (!isText(raw.id, 100)) return invalid('id', 'ID riwayat tidak valid');
  if (typeof raw.dispatchedOn !== 'string' || !isIsoDate(raw.dispatchedOn)) {
    return invalid('dispatchedOn', 'Tanggal catat tidak valid');
  }
  if (!isText(raw.buId, 100)) return invalid('buId', 'BU tidak valid');
  const { boxStart, boxSize } = raw;
  if (
    typeof boxStart !== 'number' ||
    !Number.isInteger(boxStart) ||
    boxStart < 1 ||
    boxStart > WAREHOUSE_BOX_LIMITS.numberMax
  ) {
    return invalid('boxStart', `Nomor kardus harus 1-${WAREHOUSE_BOX_LIMITS.numberMax}`);
  }
  if (
    typeof boxSize !== 'number' ||
    !Number.isInteger(boxSize) ||
    boxSize < 1 ||
    boxSize > WAREHOUSE_BOX_LIMITS.sizeMax
  ) {
    return invalid('boxSize', `Pcs per kardus harus 1-${WAREHOUSE_BOX_LIMITS.sizeMax}`);
  }
  const noteText = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (
    typeof raw.note !== 'string' ||
    [...noteText].length > WAREHOUSE_LIMITS.noteMax ||
    hasNoteControlChars(noteText)
  ) {
    return invalid('note', 'Catatan tidak valid');
  }
  if (
    !Array.isArray(raw.handoverIds) ||
    raw.handoverIds.length > WAREHOUSE_LIMITS.handoverLinksMax ||
    !raw.handoverIds.every((id) => isText(id, 100)) ||
    new Set(raw.handoverIds).size !== raw.handoverIds.length
  ) {
    return invalid('handoverIds', 'Daftar task tidak valid');
  }
  return {
    id: raw.id,
    dispatchedOn: raw.dispatchedOn,
    buId: raw.buId,
    boxStart,
    boxSize,
    note: noteText,
    handoverIds: [...raw.handoverIds] as string[],
  };
}
