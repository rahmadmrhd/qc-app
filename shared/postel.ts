/**
 * Fungsi murni Postel (stiker 4b; spek 2026-11-11): tanggal WIB, kondisi masa berlaku, peran nomor, tahap
 * peringatan email, dan nama otomatis. Murni: tanpa API runtime/DOM.
 */
import { MAX_FILE_BYTES } from './files';
import { normalizeKey } from './items';
import { manualBookNameFromTypes } from './manual-book';

export const POSTEL_LIMITS = {
  noteMax: 1000,
  numberMax: 100,
  linkMax: 2000,
  numbersMax: 50,
  itemsMax: 200,
  attachmentsMax: 10,
  attachmentMaxBytes: MAX_FILE_BYTES,
  thresholdsMax: 5,
  thresholdDaysMax: 730,
  repeatDaysMax: 365,
  recipientsMax: 20,
  listMax: 500,
  nameMax: 80,
  yearMin: 2000,
  yearMax: 2100,
} as const;

export const POSTEL_ALERT_DEFAULTS = {
  enabled: false,
  recipients: [] as string[],
  sendHour: 8,
  thresholds: [90, 60, 30] as number[],
  repeatEveryDays: 7,
};

export type PostelCondition = 'valid' | 'soon' | 'expired';
export type PostelRole = 'active' | 'old';

const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tanggal WIB (`YYYY-MM-DD`) dari epoch milidetik (offset tetap +7 jam, tanpa DST). */
export function wibDateIso(epochMs: number): string {
  return new Date(epochMs + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch UTC tengah malam dari `YYYY-MM-DD` sah, atau `null`. Tahun dibatasi 2000-2100. */
function parseDate(value: string): number | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < POSTEL_LIMITS.yearMin || year > POSTEL_LIMITS.yearMax) return null;
  const epoch = Date.UTC(year, month - 1, day);
  const date = new Date(epoch);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return epoch;
}

/** `YYYY-MM-DD` ketat, tanggal kalender nyata, tahun 2000-2100. */
export function isCalendarDate(value: string): boolean {
  return parseDate(value) !== null;
}

/** `to - from` dalam hari; keduanya `YYYY-MM-DD` (masukan tak sah menghasilkan `NaN`). */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null) return Number.NaN;
  return Math.round((b - a) / DAY_MS);
}

/** Sisa hari sampai `expiresOn` (negatif = sudah lewat) menurut tanggal WIB `today`. */
export function daysUntil(expiresOn: string, today: string): number {
  return daysBetween(today, expiresOn);
}

export function postelCondition(daysLeft: number, soonDays: number): PostelCondition {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= soonDays) return 'soon';
  return 'valid';
}

/** Larik paralel dengan `seqs`: `seq` terbesar = `active`, sisanya `old`. */
export function postelRoles(seqs: readonly number[]): PostelRole[] {
  const max = Math.max(...seqs);
  return seqs.map((seq) => (seq === max ? 'active' : 'old'));
}

/** Ambang sasaran: ambang terkecil `t` dengan `daysLeft <= t`; `-1` bila kedaluwarsa; `null` bila belum tercapai. */
export function alertTarget(daysLeft: number, thresholds: readonly number[]): number | null {
  if (daysLeft < 0) return -1;
  let target: number | null = null;
  for (const t of thresholds) {
    if (daysLeft <= t && (target === null || t < target)) target = t;
  }
  return target;
}

/**
 * Nilai yang harus dicatat sebagai `sentThreshold` baru bila nomor masuk email hari ini, selain itu `null`.
 * Kirim bila ada sasaran dan: belum pernah dikirim, atau sasaran lebih kecil dari yang terkirim, atau sasaran adalah
 * ujung (ambang terkecil yang dikonfigurasi, atau `-1`), `repeatEveryDays > 0`, dan sudah >= `repeatEveryDays` hari
 * sejak `sentOn`. `sentOn` tak sah = tidak mengulang (selisih `NaN`).
 */
export function alertDue(input: {
  daysLeft: number;
  thresholds: readonly number[];
  repeatEveryDays: number;
  sentThreshold: number | null;
  sentOn: string;
  today: string;
}): number | null {
  const target = alertTarget(input.daysLeft, input.thresholds);
  if (target === null) return null;
  if (input.sentThreshold === null) return target;
  if (target < input.sentThreshold) return target;
  const isEnd = target === -1 || target === Math.min(...input.thresholds);
  if (
    isEnd &&
    input.repeatEveryDays > 0 &&
    daysBetween(input.sentOn, input.today) >= input.repeatEveryDays
  ) {
    return target;
  }
  return null;
}

/**
 * Nama Postel dari tipe model item: duplikat (tanpa beda huruf besar) dibuang, diurutkan, digabung seperti nama Manual
 * Book. Lebih dari `nameMax` karakter dipotong menjadi paling panjang `nameMax` berakhiran elipsis.
 */
export function postelName(models: readonly string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of models) {
    const model = raw.trim();
    if (model === '') continue;
    const key = normalizeKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(model);
  }
  unique.sort((a, b) => {
    const ka = normalizeKey(a);
    const kb = normalizeKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const max = POSTEL_LIMITS.nameMax;
  if (manualBookNameFromTypes(unique, 10_000).length <= max)
    return manualBookNameFromTypes(unique, max);
  return `${manualBookNameFromTypes(unique, max - 1)}…`;
}

/** Bentuk minimal ringkasan daftar yang dipakai pencarian dan urutan (cocok dengan `PostelSummaryDto`). */
export interface PostelListable {
  id: string;
  name: string;
  /** SEMUA nomor catatan (Aktif dan Lama). */
  numbers: readonly string[];
  /** Model item yang berbeda (tanpa merk). */
  models: readonly string[];
  activeExpiresOn: string;
  condition: PostelCondition;
}

export type PostelConditionFilter = 'all' | 'soon' | 'expired';

/** Urutan daftar: tanggal habis nomor Aktif menaik, lalu nama, lalu id. */
export function comparePostels(
  a: Pick<PostelListable, 'id' | 'name' | 'activeExpiresOn'>,
  b: Pick<PostelListable, 'id' | 'name' | 'activeExpiresOn'>,
): number {
  return (
    (a.activeExpiresOn < b.activeExpiresOn ? -1 : a.activeExpiresOn > b.activeExpiresOn ? 1 : 0) ||
    a.name.localeCompare(b.name) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Penyaringan daftar di klien: `query` (tak peka huruf, `normalizeKey`) dicari pada nama, SEMUA nomor (Aktif dan Lama),
 * dan model item. Kondisi: `conditions` (banyak nilai = salah satu dari; kosong atau tak ada = semua; keputusan
 * pemilik 2026-11-22) atau, bila `conditions` tak diberikan, `condition` tunggal `soon`/`expired` (`all` = semua).
 * Urutan masukan dipertahankan.
 */
export function filterPostels<T extends PostelListable>(
  postels: readonly T[],
  filter: {
    query: string;
    condition?: PostelConditionFilter;
    conditions?: readonly PostelCondition[];
  },
): T[] {
  const term = normalizeKey(filter.query);
  const conditions = filter.conditions ?? [];
  const single = filter.condition ?? 'all';
  const matchesCondition = (condition: PostelCondition) =>
    conditions.length > 0
      ? conditions.includes(condition)
      : single === 'all' || condition === single;
  return postels.filter(
    (postel) =>
      matchesCondition(postel.condition) &&
      (term === '' ||
        normalizeKey(postel.name).includes(term) ||
        postel.numbers.some((number) => normalizeKey(number).includes(term)) ||
        postel.models.some((model) => normalizeKey(model).includes(term))),
  );
}

/** Satu alamat email polos (tanpa koma, titik koma, kurung sudut, atau spasi), paling panjang 254 karakter. */
const POSTEL_RECIPIENT_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const RECIPIENT_MAX_LENGTH = 254;

/**
 * Penerima peringatan Postel harus tepat satu alamat polos. Sengaja lebih ketat daripada `isValidEmail` (yang dipakai
 * pengaturan stok): alamat berisi koma atau `<...>` dapat menjadi banyak penerima di header surel.
 */
export function isPostelRecipient(email: string): boolean {
  return email.length <= RECIPIENT_MAX_LENGTH && POSTEL_RECIPIENT_PATTERN.test(email);
}

// Pembersihan karakter kontrol dipindah ke modul netral `./text` (dipakai juga notifikasi); diekspor ulang agar impor lama tetap.
export { hasBidiControls, hasControlChars, stripControlChars } from './text';
