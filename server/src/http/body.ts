/**
 * Batas badan permintaan. `Bun.serve` memakai `MAX_REQUEST_BODY_BYTES` (bawaan Bun 128 MB terlalu longgar: badan
 * dimuat ke memori sebelum autentikasi): batas berkas terbesar (8 MB) + overhead base64 (x4/3) + amplop JSON.
 * Di atas itu Bun membalas 413 tanpa menjalankan aplikasi.
 */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Membaca badan sebagai teks UTF-8 dengan batas byte, TANPA mempercayai `content-length` (tidak ada pada badan
 * chunked, dan dapat berbohong). Mengembalikan `undefined` bila batas terlampaui; pembacaan dihentikan saat itu
 * juga (sisa badan tidak dimuat). Badan kosong menghasilkan string kosong.
 */
export async function readTextLimited(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return undefined;
  if (request.body === null) return '';
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
  return new TextDecoder().decode(bytes);
}
