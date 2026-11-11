import { readObject } from '@server/core/validate';
import type {
  GetPostelInput,
  ListPostelItemOptionsInput,
  RemovePostelInput,
  SavePostelInput,
  SavePostelNumberInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { isCalendarDate, POSTEL_LIMITS } from '@shared/postel';
import { isHttpUrl } from '@shared/qrcode';
import { POSTEL_ITEM_OPTIONS_MAX_LIMIT } from './items';

const MAX_ID_LENGTH = 100;

function isParsableUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Satu baris nomor; mengembalikan baris atau pesan galat (tanpa awalan posisi). */
function readNumberRow(value: unknown): SavePostelNumberInput | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Bukan objek';
  const row = value as Record<string, unknown>;
  const id = row.id;
  if (id !== undefined && id !== null && id !== '') {
    if (typeof id !== 'string' || id.length > MAX_ID_LENGTH) return 'Id nomor tidak valid';
  }
  const { number, expiresOn, link } = row;
  if (typeof number !== 'string' || number.trim() === '') return 'Nomor sertifikat wajib diisi';
  const trimmed = number.trim();
  if (trimmed.length > POSTEL_LIMITS.numberMax) {
    return `Nomor sertifikat maksimal ${POSTEL_LIMITS.numberMax} karakter`;
  }
  if (normalizeKey(trimmed) === '') return 'Nomor sertifikat harus memuat huruf atau angka';
  if (typeof expiresOn !== 'string' || !isCalendarDate(expiresOn)) {
    return 'Tanggal habis harus tanggal kalender yang sah (YYYY-MM-DD)';
  }
  const linkText = typeof link === 'string' ? link.trim() : link === undefined ? '' : null;
  if (linkText === null) return 'Tautan harus berupa teks';
  if (linkText.length > POSTEL_LIMITS.linkMax) {
    return `Tautan maksimal ${POSTEL_LIMITS.linkMax} karakter`;
  }
  if (linkText !== '' && !(isHttpUrl(linkText) && isParsableUrl(linkText))) {
    return 'Tautan harus diawali http:// atau https:// tanpa spasi';
  }
  return {
    ...(typeof id === 'string' && id !== '' ? { id } : {}),
    number: trimmed,
    expiresOn,
    link: linkText,
  };
}

/** Daftar nomor: 1..50 baris sah, tanpa nomor kembar (menurut `normalizeKey`) dan tanpa id ganda. */
function readNumbers(value: unknown): SavePostelNumberInput[] | string {
  if (!Array.isArray(value)) return 'Daftar nomor sertifikat wajib diisi';
  if (value.length === 0) return 'Minimal satu nomor sertifikat';
  if (value.length > POSTEL_LIMITS.numbersMax) {
    return `Maksimal ${POSTEL_LIMITS.numbersMax} nomor sertifikat`;
  }
  const rows: SavePostelNumberInput[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const row = readNumberRow(raw);
    if (typeof row === 'string') return `Nomor ${index + 1}: ${row}`;
    const key = normalizeKey(row.number);
    if (keys.has(key)) return `Nomor ${index + 1}: nomor sertifikat kembar`;
    keys.add(key);
    if (row.id !== undefined) {
      if (ids.has(row.id)) return `Nomor ${index + 1}: id nomor ganda`;
      ids.add(row.id);
    }
    rows.push(row);
  }
  return rows;
}

export function validateSavePostel(raw: unknown): SavePostelInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  // Mengubah wajib membawa versi yang dimuat: tanpa itu, perubahan orang lain bisa tertimpa diam-diam.
  if (id && !expectedUpdatedAt) reader.fail('expectedUpdatedAt', 'Wajib diisi saat mengubah');
  const note = reader.str('note', { max: POSTEL_LIMITS.noteMax });
  const itemIdsRaw = reader.raw('itemIds');
  if (
    !Array.isArray(itemIdsRaw) ||
    itemIdsRaw.length > POSTEL_LIMITS.itemsMax ||
    itemIdsRaw.some(
      (value) => typeof value !== 'string' || value === '' || value.length > MAX_ID_LENGTH,
    )
  ) {
    reader.fail('itemIds', `Pilih maksimal ${POSTEL_LIMITS.itemsMax} item`);
  }
  const numbers = readNumbers(reader.raw('numbers'));
  if (typeof numbers === 'string') reader.fail('numbers', numbers);
  const attachmentIdsRaw = reader.raw('attachmentIds');
  if (
    !Array.isArray(attachmentIdsRaw) ||
    attachmentIdsRaw.length > POSTEL_LIMITS.attachmentsMax ||
    attachmentIdsRaw.some(
      (value) => typeof value !== 'string' || value === '' || value.length > MAX_ID_LENGTH,
    )
  ) {
    reader.fail('attachmentIds', `Lampiran maksimal ${POSTEL_LIMITS.attachmentsMax} berkas`);
  } else if (attachmentIdsRaw.length > 0) {
    // Lampiran dibuka pada tugas berikutnya (unggah dan pemasangan berkas Postel).
    reader.fail('attachmentIds', 'Lampiran belum dapat disimpan');
  }
  reader.done();
  return {
    ...(id ? { id } : {}),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    note,
    itemIds: [...new Set(itemIdsRaw as string[])],
    numbers: numbers as SavePostelNumberInput[],
    attachmentIds: [...new Set(attachmentIdsRaw as string[])],
  };
}

export function validateGetPostel(raw: unknown): GetPostelInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  reader.done();
  return { id };
}

export function validateRemovePostel(raw: unknown): RemovePostelInput {
  return validateGetPostel(raw);
}

/** Opsi item untuk pemilih: input boleh kosong; `cursor` buram (kunci item terakhir). */
export function validateListPostelItemOptions(raw: unknown): ListPostelItemOptionsInput {
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
      limit > POSTEL_ITEM_OPTIONS_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${POSTEL_ITEM_OPTIONS_MAX_LIMIT}`);
  }
  const query = reader.str('query', { max: 100 });
  reader.done();
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
  };
}
