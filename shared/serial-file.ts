import { hasControlChars } from './postel';
import { isIsoDate, normalizeSerial, SERIAL_LIMITS, serialProblem } from './serials';

export const QCSN_FORMAT = 'qc-sn-batch';
export const QCSN_VERSION = 1;
export const QCSN_MAX_BYTES = 2_000_000;
export const QCSN_MAX_ROWS = 1000;

const LABEL_MAX = 255;
const ID_MAX = 100;
const STAMP_MAX = 40;
const STICKERS_MAX = 200;
const CLIENT_ID = /^[A-Za-z0-9-]{8,100}$/;

export interface QcsnSticker {
  stickerId: string;
  stickerLabel: string;
  qty: number;
}

export interface QcsnRow {
  clientId: string;
  serial: string;
  testDate: string;
  itemId: string;
  itemLabel: string;
  /** Kosong bila berkas tidak memuatnya (item hanya di satu BU). */
  buId: string;
  buLabel: string;
  locationId: string;
  locationLabel: string;
  sample: boolean;
  note: string;
  /** Tahap 5a hanya menerima `good`. */
  status: 'good';
  source: 'manual' | 'countrylock';
  capturedAt: string;
  reinjectedAt?: string;
  stickers?: QcsnSticker[];
}

export interface QcsnFile {
  format: typeof QCSN_FORMAT;
  version: number;
  exportedAt: string;
  app: { name: string; version: string };
  /** Hanya baris yang lolos validasi (serial sudah dinormalisasi). */
  rows: QcsnRow[];
  checksum: string;
}

export interface QcsnProblem {
  /** Nomor baris mulai dari 1; `null` bila masalahnya bukan pada satu baris. */
  row: number | null;
  message: string;
}

export type QcsnParse =
  | { ok: true; file: QcsnFile; rows: QcsnRow[]; problems: QcsnProblem[] }
  | { ok: false; message: string };

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pembacaan kunci hanya lewat nama yang dikenal dan hanya properti milik sendiri. */
function own(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

type Fail = { error: string };

function isFail(value: unknown): value is Fail {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function readText(
  source: Record<string, unknown>,
  key: string,
  max: number,
  options: { required?: boolean } = {},
): string | Fail {
  const value = own(source, key);
  if (value === undefined && options.required === false) return '';
  if (typeof value !== 'string') return { error: `${key} harus berupa teks` };
  if (options.required !== false && value.trim() === '') return { error: `${key} wajib diisi` };
  if ([...value].length > max) return { error: `${key} terlalu panjang` };
  if (hasControlChars(value)) return { error: `${key} memuat karakter yang tidak diizinkan` };
  return value;
}

function readSticker(raw: unknown): QcsnSticker | Fail {
  if (!isPlainObject(raw)) return { error: 'stiker tidak valid' };
  const stickerId = readText(raw, 'stickerId', ID_MAX);
  if (isFail(stickerId)) return stickerId;
  const stickerLabel = readText(raw, 'stickerLabel', LABEL_MAX, { required: false });
  if (isFail(stickerLabel)) return stickerLabel;
  const qty = own(raw, 'qty');
  if (
    typeof qty !== 'number' ||
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > SERIAL_LIMITS.stickerQtyMax
  ) {
    return { error: `jumlah stiker harus bilangan bulat 1 sampai ${SERIAL_LIMITS.stickerQtyMax}` };
  }
  return { stickerId, stickerLabel, qty };
}

function readRow(raw: unknown): QcsnRow | Fail {
  if (!isPlainObject(raw)) return { error: 'baris bukan objek' };

  const clientId = own(raw, 'clientId');
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
    return { error: 'clientId harus 8-100 karakter huruf, angka, atau tanda hubung' };
  }
  const serialRaw = own(raw, 'serial');
  if (typeof serialRaw !== 'string') return { error: 'serial harus berupa teks' };
  const serial = normalizeSerial(serialRaw);
  const problem = serialProblem(serial);
  if (problem !== null) return { error: `serial tidak valid (${problem})` };
  const testDate = own(raw, 'testDate');
  if (typeof testDate !== 'string' || !isIsoDate(testDate)) {
    return { error: 'testDate harus tanggal YYYY-MM-DD yang sah' };
  }
  const itemId = readText(raw, 'itemId', ID_MAX);
  if (isFail(itemId)) return itemId;
  const itemLabel = readText(raw, 'itemLabel', LABEL_MAX, { required: false });
  if (isFail(itemLabel)) return itemLabel;
  const buId = readText(raw, 'buId', ID_MAX, { required: false });
  if (isFail(buId)) return buId;
  const buLabel = readText(raw, 'buLabel', LABEL_MAX, { required: false });
  if (isFail(buLabel)) return buLabel;
  const locationId = readText(raw, 'locationId', ID_MAX);
  if (isFail(locationId)) return locationId;
  const locationLabel = readText(raw, 'locationLabel', LABEL_MAX, { required: false });
  if (isFail(locationLabel)) return locationLabel;
  const sample = own(raw, 'sample');
  if (typeof sample !== 'boolean') return { error: 'sample harus true atau false' };
  const note = readText(raw, 'note', SERIAL_LIMITS.noteMax, { required: false });
  if (isFail(note)) return note;
  const status = own(raw, 'status');
  if (status !== 'good') return { error: 'status belum didukung (hanya good)' };
  const source = own(raw, 'source');
  if (source !== 'manual' && source !== 'countrylock') {
    return { error: 'source harus manual atau countrylock' };
  }
  const capturedAt = readText(raw, 'capturedAt', STAMP_MAX);
  if (isFail(capturedAt)) return capturedAt;

  const result: QcsnRow = {
    clientId,
    serial,
    testDate,
    itemId,
    itemLabel,
    buId,
    buLabel,
    locationId,
    locationLabel,
    sample,
    note,
    status: 'good',
    source,
    capturedAt,
  };

  if (own(raw, 'reinjectedAt') !== undefined) {
    const reinjectedAt = readText(raw, 'reinjectedAt', STAMP_MAX);
    if (isFail(reinjectedAt)) return reinjectedAt;
    result.reinjectedAt = reinjectedAt;
  }

  const stickers = own(raw, 'stickers');
  if (stickers !== undefined) {
    if (!Array.isArray(stickers) || stickers.length > STICKERS_MAX) {
      return { error: 'stickers harus berupa daftar' };
    }
    const list: QcsnSticker[] = [];
    for (const entry of stickers) {
      const sticker = readSticker(entry);
      if (isFail(sticker)) return sticker;
      list.push(sticker);
    }
    result.stickers = list;
  }
  return result;
}

/** JSON.parse + validasi tulisan tangan; tidak menghitung hash. Baris tak valid dilaporkan, tidak menggagalkan berkas. */
export function parseQcsn(text: string): QcsnParse {
  if (utf8Length(text) > QCSN_MAX_BYTES) return { ok: false, message: 'Berkas terlalu besar' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Berkas bukan JSON yang valid' };
  }
  if (!isPlainObject(parsed)) return { ok: false, message: 'Isi berkas tidak dikenal' };
  if (own(parsed, 'format') !== QCSN_FORMAT) {
    return { ok: false, message: 'Bukan berkas serial number QC' };
  }
  const version = own(parsed, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: 'Versi berkas tidak valid' };
  }
  if (version > QCSN_VERSION) {
    return {
      ok: false,
      message: 'Berkas dibuat oleh versi lebih baru aplikasi; perbarui aplikasi lalu coba lagi',
    };
  }
  const rawRows = own(parsed, 'rows');
  if (!Array.isArray(rawRows)) return { ok: false, message: 'Daftar baris tidak ditemukan' };
  if (rawRows.length > QCSN_MAX_ROWS) {
    return { ok: false, message: `Berkas memuat lebih dari ${QCSN_MAX_ROWS} baris` };
  }
  const checksum = own(parsed, 'checksum');
  if (typeof checksum !== 'string') return { ok: false, message: 'Checksum berkas hilang' };
  const exportedAt = own(parsed, 'exportedAt');
  const app = own(parsed, 'app');
  const appInfo = isPlainObject(app) ? app : {};
  const appName = own(appInfo, 'name');
  const appVersion = own(appInfo, 'version');

  const rows: QcsnRow[] = [];
  const problems: QcsnProblem[] = [];
  const seen = new Set<string>();
  rawRows.forEach((raw, index) => {
    const row = readRow(raw);
    if (isFail(row)) {
      problems.push({ row: index + 1, message: row.error });
      return;
    }
    if (seen.has(row.clientId)) {
      problems.push({ row: index + 1, message: 'clientId kembar' });
      return;
    }
    seen.add(row.clientId);
    rows.push(row);
  });

  return {
    ok: true,
    file: {
      format: QCSN_FORMAT,
      version,
      exportedAt: typeof exportedAt === 'string' ? exportedAt : '',
      app: {
        name: typeof appName === 'string' ? appName : '',
        version: typeof appVersion === 'string' ? appVersion : '',
      },
      rows,
      checksum,
    },
    rows,
    problems,
  };
}

/** Bentuk kanonis baris untuk hash: urutan kunci tetap, kunci opsional hanya bila ada. */
export function qcsnCanonical(rows: readonly QcsnRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      clientId: row.clientId,
      serial: row.serial,
      testDate: row.testDate,
      itemId: row.itemId,
      itemLabel: row.itemLabel,
      buId: row.buId,
      buLabel: row.buLabel,
      locationId: row.locationId,
      locationLabel: row.locationLabel,
      sample: row.sample,
      note: row.note,
      status: row.status,
      source: row.source,
      capturedAt: row.capturedAt,
      ...(row.reinjectedAt !== undefined ? { reinjectedAt: row.reinjectedAt } : {}),
      ...(row.stickers !== undefined
        ? {
            stickers: row.stickers.map((s) => ({
              stickerId: s.stickerId,
              stickerLabel: s.stickerLabel,
              qty: s.qty,
            })),
          }
        : {}),
    })),
  );
}
