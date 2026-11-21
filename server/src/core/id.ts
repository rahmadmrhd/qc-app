import { formatUlid, nextUlidState, type UlidState } from '@shared/ids';

// Satu keadaan per proses: ID yang dibuat dalam milidetik yang sama tetap menaik (monotonik). Antar proses hanya urutan
// per milidetik yang tak terjamin, dan itu tidak dipakai di mana pun (urutan tampilan memakai `created_at`/`seq`).
let state: UlidState | null = null;

/**
 * ID baris basis data baru: ULID huruf kecil 26 karakter (`shared/ids.ts`). Pengganti `crypto.randomUUID()` untuk kolom
 * `id`: berurutan menurut waktu agar penyisipan selalu di ujung indeks klaster. JANGAN dipakai untuk nilai yang harus tak
 * tertebak (token, nama berkas sementara, kunci sesi): bagian acaknya hanya 80 bit dan awalannya membuka waktu pembuatan;
 * untuk itu tetap `crypto.randomUUID()`.
 */
export function newId(): string {
  state = nextUlidState(state, Date.now(), crypto.getRandomValues(new Uint8Array(10)));
  return formatUlid(state);
}
