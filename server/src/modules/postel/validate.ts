import { isValidEmail, normalizeEmail } from '@server/core/email';
import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import { PAGE_MAX_LIMIT, parseAuditCursor } from '@server/modules/access/validate';
import type {
  GetPostelFileInput,
  GetPostelInput,
  ListPostelHistoryInput,
  ListPostelItemOptionsInput,
  PostelAlertSettings,
  RemovePostelInput,
  SavePostelInput,
  SavePostelNumberInput,
  SavePostelSettingsInput,
  UploadPostelFileInput,
} from '@shared/contract';
import {
  isImageMime,
  isPdfBytes,
  isPostelFileMime,
  matchesImageBytesSignature,
} from '@shared/files';
import { normalizeKey } from '@shared/items';
import { isCalendarDate, POSTEL_ALERT_DEFAULTS, POSTEL_LIMITS } from '@shared/postel';
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

/** Riwayat: `id` wajib; `cursor` = kursor audit (`<ts>~<id>`), `limit` 1..50 (bawaan 20 di servis). */
export function validateListPostelHistory(raw: unknown): ListPostelHistoryInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  const cursor = reader.raw('cursor');
  if (
    cursor !== undefined &&
    cursor !== null &&
    (typeof cursor !== 'string' || !parseAuditCursor(cursor))
  ) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${PAGE_MAX_LIMIT}`);
  }
  reader.done();
  return {
    id,
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

function readPostelAlert(value: unknown, reader: ObjectReader): PostelAlertSettings {
  const fallback: PostelAlertSettings = {
    enabled: false,
    recipients: [],
    sendHour: POSTEL_ALERT_DEFAULTS.sendHour,
    thresholds: [...POSTEL_ALERT_DEFAULTS.thresholds],
    repeatEveryDays: POSTEL_ALERT_DEFAULTS.repeatEveryDays,
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reader.fail('alert', 'Pengaturan peringatan harus berupa objek');
    return fallback;
  }
  const source = value as Record<string, unknown>;
  if (typeof source.enabled !== 'boolean') reader.fail('enabled', 'Sakelar harus true atau false');
  const hour = source.sendHour;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    reader.fail('sendHour', 'Jam harus bilangan bulat 0 sampai 23');
  }
  const repeat = source.repeatEveryDays;
  if (
    typeof repeat !== 'number' ||
    !Number.isInteger(repeat) ||
    repeat < 0 ||
    repeat > POSTEL_LIMITS.repeatDaysMax
  ) {
    reader.fail(
      'repeatEveryDays',
      `Pengulangan harus bilangan bulat 0 sampai ${POSTEL_LIMITS.repeatDaysMax} hari`,
    );
  }
  let thresholds = fallback.thresholds;
  const rawThresholds = source.thresholds;
  if (
    !Array.isArray(rawThresholds) ||
    rawThresholds.length < 1 ||
    rawThresholds.length > POSTEL_LIMITS.thresholdsMax ||
    rawThresholds.some(
      (entry) =>
        typeof entry !== 'number' ||
        !Number.isInteger(entry) ||
        entry < 1 ||
        entry > POSTEL_LIMITS.thresholdDaysMax,
    ) ||
    new Set(rawThresholds).size !== rawThresholds.length
  ) {
    reader.fail(
      'thresholds',
      `Ambang harus 1-${POSTEL_LIMITS.thresholdsMax} bilangan bulat unik antara 1 dan ${POSTEL_LIMITS.thresholdDaysMax} hari`,
    );
  } else {
    thresholds = [...(rawThresholds as number[])].sort((a, b) => b - a);
  }
  const recipients: string[] = [];
  if (!Array.isArray(source.recipients)) {
    reader.fail('recipients', 'Penerima harus berupa daftar email');
  } else if (source.recipients.length > POSTEL_LIMITS.recipientsMax) {
    reader.fail('recipients', `Maksimal ${POSTEL_LIMITS.recipientsMax} penerima`);
  } else {
    const seen = new Set<string>();
    for (const item of source.recipients) {
      const email = typeof item === 'string' ? normalizeEmail(item) : '';
      if (!isValidEmail(email)) {
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
  return {
    enabled: source.enabled === true,
    recipients,
    sendHour: typeof hour === 'number' ? hour : fallback.sendHour,
    thresholds,
    repeatEveryDays: typeof repeat === 'number' ? repeat : fallback.repeatEveryDays,
  };
}

/** `expectedUpdatedAt` boleh kosong/tak ada (penyimpanan pertama; tanpa If-Match). */
export function validateSavePostelSettings(raw: unknown): SavePostelSettingsInput {
  const reader = readObject(raw);
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt') ?? '';
  const alert = readPostelAlert(reader.raw('alert'), reader);
  reader.done();
  return { expectedUpdatedAt, alert };
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

/**
 * Unggah lampiran: MIME gambar atau PDF; 1..10 MB; isi diperiksa menurut TANDA TANGAN BYTE (MIME kiriman klien tidak
 * dipercaya; PDF harus diawali `%PDF-`). Dimensi gambar dibaca di servis.
 */
export function validateUploadPostelFile(raw: unknown): UploadPostelFileInput {
  const reader = readObject(raw);
  const mime = reader.raw('mime');
  const bytes = reader.raw('bytes');
  if (!isPostelFileMime(mime)) reader.fail('mime', 'Hanya JPEG, PNG, WebP, atau PDF');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    reader.fail('bytes', 'Isi berkas tidak valid');
  } else if (bytes.length > POSTEL_LIMITS.attachmentMaxBytes) {
    reader.fail('bytes', 'Ukuran lampiran maksimal 10 MB');
  } else if (mime === 'application/pdf') {
    if (!isPdfBytes(bytes)) reader.fail('bytes', 'Isi berkas bukan PDF');
  } else if (isImageMime(mime) && !matchesImageBytesSignature(mime, bytes)) {
    reader.fail('bytes', 'Isi berkas tidak sesuai jenis gambar');
  }
  reader.done();
  return { mime: mime as string, bytes: bytes as Uint8Array };
}

export function validateGetPostelFile(raw: unknown): GetPostelFileInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  reader.done();
  return { id };
}
