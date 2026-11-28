import type { ClFileDto } from '@shared/contract';
import { CL_BINARY_MAX_BYTES } from '@shared/countrylock-bundle';
import { type ApiCall, api as defaultApi } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';

const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 600;
/** Galat yang tak membaik bila diulang: potongan atau sesinya memang ditolak server. */
const PERMANENT_CODES = new Set([
  'VALIDATION',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHENTICATED',
]);

/** sha256 heksadesimal huruf kecil (WebCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface UploadBinaryOptions {
  /** Disuntik tes; bawaan = klien API aplikasi. */
  api?: ApiCall;
  /** Dipanggil dengan jumlah byte yang sudah diterima server (naik setelah tiap potongan). */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /** Jeda dasar antar percobaan ulang (dikali nomor percobaan); 0 di tes. */
  retryDelayMs?: number;
}

function abortedError(): Error {
  return new Error('Unggahan dibatalkan');
}

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mengunggah berkas biner router bertahap (spek §5.2): hash sha256 dihitung di sini, sesi dibuka (`clUploads.start`),
 * potongan dikirim BERURUT sebesar `chunkBytes` dari server, tiap potongan diulang bila galatnya sementara (jaringan,
 * 5xx), lalu `clUploads.finish` merakit dan memeriksa ukuran/sha256. Mengunggah ulang isi yang sama idempoten di server.
 */
export async function uploadBinary(
  file: File,
  path: string,
  options: UploadBinaryOptions = {},
): Promise<ClFileDto> {
  const call = options.api ?? defaultApi;
  const retryDelay = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  if (file.size === 0) throw new Error('Berkas kosong');
  if (file.size > CL_BINARY_MAX_BYTES) {
    throw new Error(`Ukuran berkas melebihi ${CL_BINARY_MAX_BYTES / (1024 * 1024)} MB`);
  }
  const sha256 = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
  if (options.signal?.aborted) throw abortedError();
  const session = await call('clUploads.start', { path, role: 'router', size: file.size, sha256 });
  const total = file.size;
  let sent = 0;
  for (let index = 0, offset = 0; offset < total; index += 1, offset += session.chunkBytes) {
    if (options.signal?.aborted) throw abortedError();
    const end = Math.min(offset + session.chunkBytes, total);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    for (let attempt = 1; ; attempt += 1) {
      try {
        await call('clUploads.chunk', { id: session.uploadId, idx: String(index), bytes });
        break;
      } catch (error) {
        const permanent = error instanceof ApiError && PERMANENT_CODES.has(error.code);
        if (permanent || attempt >= MAX_ATTEMPTS || options.signal?.aborted) throw error;
        await wait(retryDelay * attempt);
      }
    }
    sent = end;
    options.onProgress?.(sent, total);
  }
  if (options.signal?.aborted) throw abortedError();
  return call('clUploads.finish', { id: session.uploadId });
}
