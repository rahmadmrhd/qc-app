import { formatUlid, nextUlidState, type UlidState } from '@shared/ids';

/** Sumber waktu (ms) dan 10 byte acak; disuntik hanya oleh tes. */
export interface IdGeneratorDeps {
  now?: () => number;
  random?: () => Uint8Array;
}

/**
 * Pembuat ID dengan keadaan monotonik SENDIRI: ID yang dibuat dalam milidetik yang sama (atau saat jam mundur) tetap menaik.
 * Antar pembuat/proses hanya urutan per milidetik yang tak terjamin, dan itu tidak dipakai di mana pun (urutan tampilan
 * memakai `created_at`/`seq`).
 */
export function createIdGenerator(deps: IdGeneratorDeps = {}): () => string {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? (() => crypto.getRandomValues(new Uint8Array(10)));
  let state: UlidState | null = null;
  return () => {
    state = nextUlidState(state, now(), random());
    return formatUlid(state);
  };
}

/**
 * ID baris basis data baru: ULID huruf kecil 26 karakter (`shared/ids.ts`). Pengganti `crypto.randomUUID()` untuk kolom
 * `id`: berurutan menurut waktu agar penyisipan selalu di ujung indeks klaster. JANGAN dipakai untuk nilai yang harus tak
 * tertebak (token, nama berkas sementara, kunci sesi): bagian acaknya hanya 80 bit dan awalannya membuka waktu pembuatan;
 * untuk itu tetap `crypto.randomUUID()`.
 */
export const newId: () => string = createIdGenerator();
