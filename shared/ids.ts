// ID baris basis data: ULID huruf kecil (keputusan pemilik 2026-11-22; spek `docs/superpowers/specs/2026-11-22-id-ulid-design.md`).
//
// Bentuk: 26 karakter Crockford base32 huruf kecil = 48 bit waktu (milidetik, 10 karakter) + 80 bit acak (16 karakter).
// Karena awalannya waktu, ID baru selalu masuk di ujung indeks klaster InnoDB (tanpa page split) dan urutan teksnya = urutan
// pembuatan; kolasi `utf8mb4_nopad_bin` membandingkan byte, jadi urutan teks itu benar tanpa pengaturan tambahan.
//
// File ini MURNI (tanpa API runtime/DOM): sumber waktu dan byte acak disuntik pemanggil. Pembuat ID di server ada di
// `server/src/core/id.ts`. Huruf kecil dipilih agar selaras dengan konvensi "UUID huruf kecil" yang ada; validator menolak
// huruf besar (tidak dinormalisasi diam-diam) karena kolasi bersifat byte-persis.

/** Alfabet Crockford base32 huruf kecil (tanpa i, l, o, u). Urutan karakternya = urutan leksikografis byte. */
export const ULID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ULID_LENGTH = 26;
/** Waktu terbesar yang muat di 48 bit (tahun 10889). */
export const ULID_TIME_MAX = 2 ** 48 - 1;

const TIME_LENGTH = 10;
const RANDOM_BYTES = 10;
const RANDOM_MAX = (1n << 80n) - 1n;

/** Karakter pertama paling banyak `7` karena 26 x 5 = 130 bit sedangkan ID hanya 128 bit. */
export const ULID_PATTERN = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/**
 * UUID lama (v4 buatan aplikasi dan v5 hasil migrasi data lama): dipakai tes, pemeriksaan sisa, dan lapisan terjemahan ID lama
 * sementara (`server/src/core/legacy-ids.ts`, satu-satunya pemakai pola ini di repo selain tes). Migrasi UUID -> ULID dikerjakan
 * skrip operator LOKAL milik pemilik di luar repo (keputusan pemilik 2026-11-22); kesamaan pola dengan skrip itu dijaga
 * manual, tak ada tes paritas.
 */
export const LEGACY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True bila `value` ULID huruf kecil yang sah (huruf besar ditolak). */
export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}

/** Keadaan pembangkit monotonik: waktu terakhir dan 80 bit acaknya. */
export interface UlidState {
  time: number;
  random: bigint;
}

function randomOf(bytes: Uint8Array): bigint {
  if (bytes.length < RANDOM_BYTES) throw new RangeError('ULID butuh 10 byte acak');
  let value = 0n;
  for (let i = 0; i < RANDOM_BYTES; i++) value = (value << 8n) | BigInt(bytes[i] ?? 0);
  return value;
}

/**
 * Langkah pembangkit monotonik. Bila `timeMs` tidak lebih baru dari `prev`, waktu ditahan dan bagian acak dinaikkan 1,
 * jadi urutan tetap menaik walau banyak ID dibuat dalam milidetik yang sama atau jam mundur. Bagian acak yang meluap
 * memajukan waktu 1 ms dengan acak baru.
 */
export function nextUlidState(
  prev: UlidState | null,
  timeMs: number,
  randomBytes: Uint8Array,
): UlidState {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > ULID_TIME_MAX) {
    throw new RangeError('Waktu ULID di luar rentang 48 bit');
  }
  if (prev !== null && timeMs <= prev.time) {
    if (prev.random < RANDOM_MAX) return { time: prev.time, random: prev.random + 1n };
    if (prev.time >= ULID_TIME_MAX) throw new RangeError('Waktu ULID di luar rentang 48 bit');
    return { time: prev.time + 1, random: randomOf(randomBytes) };
  }
  return { time: timeMs, random: randomOf(randomBytes) };
}

/** Menulis keadaan menjadi 26 karakter. */
export function formatUlid(state: UlidState): string {
  let value = (BigInt(state.time) << 80n) | state.random;
  let out = '';
  for (let i = 0; i < ULID_LENGTH; i++) {
    out = (ULID_ALPHABET[Number(value & 31n)] as string) + out;
    value >>= 5n;
  }
  return out;
}

/** Waktu pembuatan (ms sejak epoch) yang tertanam di ULID; `null` bila bukan ULID yang sah. */
export function ulidTime(id: string): number | null {
  if (!isUlid(id)) return null;
  let time = 0;
  for (let i = 0; i < TIME_LENGTH; i++) time = time * 32 + ULID_ALPHABET.indexOf(id[i] as string);
  return time;
}
