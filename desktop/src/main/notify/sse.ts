// Pengurai aliran SSE (text/event-stream) murni: potongan teks masuk, bingkai lengkap keluar. Mengikuti spesifikasi
// HTML (baris dipisah CRLF/LF/CR, bingkai diakhiri baris kosong, baris berawalan ":" = komentar/detak jantung,
// beberapa `data:` digabung dengan baris baru). Tidak ada I/O di sini, jadi mudah diuji.

export interface SseFrame {
  event: string;
  data: string;
  id: string | null;
}

/** Batas satu bingkai (data): server hanya mengirim notifikasi kecil; melewatinya = aliran rusak/berbahaya. */
export const SSE_MAX_BUFFER_CHARS = 64 * 1024;

export interface SseParser {
  /** Memasukkan potongan teks; mengembalikan bingkai yang selesai (bisa kosong). Melempar bila melewati batas. */
  push(chunk: string): SseFrame[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  // Spek: CR ujung potongan bisa jadi separuh dari CRLF; kita menormalkan saat memproses baris utuh.
  return {
    push(chunk) {
      buffer += chunk;
      if (buffer.length > SSE_MAX_BUFFER_CHARS) {
        buffer = '';
        throw new Error('Bingkai SSE terlalu besar');
      }
      const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n');
      const frames: SseFrame[] = [];
      let rest = normalized;
      for (;;) {
        const cut = rest.indexOf('\n\n');
        if (cut < 0) break;
        const block = rest.slice(0, cut);
        rest = rest.slice(cut + 2);
        const frame = parseBlock(block);
        if (frame) frames.push(frame);
      }
      buffer = rest;
      return frames;
    },
  };
}

function parseBlock(block: string): SseFrame | null {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  let any = false;
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value;
      any = true;
    } else if (field === 'data') {
      data.push(value);
      any = true;
    } else if (field === 'id') {
      // `id` yang memuat NUL diabaikan (spek).
      if (!value.includes('\0')) id = value;
      any = true;
    }
    // `retry` dan field lain diabaikan: jeda sambung ulang ditentukan klien.
  }
  return any ? { event, data: data.join('\n'), id } : null;
}
