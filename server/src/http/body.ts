import { API_ROUTES } from '@shared/api';

/**
 * Batas badan JSON REST: 2 MB (keputusan pemilik 2026-11-06). Base64 sudah hilang dari kabel (berkas lewat rute
 * biner dengan batasnya sendiri), dan muatan JSON sah terbesar (`handovers.saveBatch`: 30 task x 5.000 karakter)
 * kurang dari 1 MB bahkan dengan karakter terburuk (dijaga `body.test.ts`). Batas kecil memperkecil permukaan
 * serangan memori: badan di atasnya = 413 problem+json (code VALIDATION) tanpa dimuat penuh (`readTextLimited`).
 */
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Batas badan `/sync` (QC Desktop): nilai lama (16 MB, dulu batas global) dipertahankan apa adanya; ditinjau di
 * Task 25 (penulisan ulang kabel sinkron). Dipakai `handler.ts` dan ikut menentukan batas global di bawah.
 */
export const SYNC_MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Selisih kecil di atas batas rute biner terbesar untuk overhead HTTP/multipart yang belum terhitung di tabel. */
const BINARY_BODY_OVERHEAD_BYTES = 64 * 1024;

/** Batas `maxBytes` terbesar di antara rute biner tabel `API_ROUTES` (sumber tunggal, bukan angka kedua). */
export const MAX_BINARY_ROUTE_BYTES = Math.max(
  ...Object.values(API_ROUTES).flatMap((def) => [
    def.rawBody?.maxBytes ?? 0,
    def.multipart?.maxBytes ?? 0,
  ]),
);

/**
 * Batas global `Bun.serve` (`maxRequestBodySize`; bawaan Bun 128 MB terlalu longgar: badan dimuat ke memori sebelum
 * autentikasi; di atasnya Bun membalas 413 tanpa menjalankan aplikasi) = yang terbesar antara rute biner terbesar
 * (+ overhead) dan `/sync`. Selama `/sync` memakai 16 MB, batas global efektif tetap 16 MB; ia turun ke
 * ~10 MB begitu `SYNC_MAX_BODY_BYTES` diturunkan di T25. Rute REST JSON dibatasi `MAX_JSON_BODY_BYTES`, rute biner
 * oleh `maxBytes` masing-masing, keduanya saat dibaca (setelah sesi diperiksa).
 */
export const MAX_REQUEST_BODY_BYTES = Math.max(
  MAX_BINARY_ROUTE_BYTES + BINARY_BODY_OVERHEAD_BYTES,
  SYNC_MAX_BODY_BYTES,
);

/**
 * Membaca badan sebagai byte dengan batas, TANPA mempercayai `content-length` (tidak ada pada badan chunked, dan
 * dapat berbohong). Mengembalikan `undefined` bila batas terlampaui: `content-length` yang sudah di atas batas
 * ditolak tanpa membaca apa pun, dan pembacaan aliran dihentikan (`cancel`) begitu total melewati batas, jadi
 * sisa badan tidak pernah dimuat ke memori. Badan kosong menghasilkan `Uint8Array` kosong.
 */
export async function readBytesLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Seperti `readBytesLimited` tetapi mengurai UTF-8; `undefined` bila batas terlampaui. */
export async function readTextLimited(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  const bytes = await readBytesLimited(request, maxBytes);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}
