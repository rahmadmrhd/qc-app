import { appError } from '@server/core/errors';
import type { TokenProvider } from './auth';

/** Jeda bertahap sebelum percobaan ulang ke-1, ke-2, ke-3 (operasi idempoten saja). */
const RETRY_DELAYS_MS = [500, 1500, 4000];
const DEFAULT_TIMEOUT_MS = 30_000;
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'sharingRateLimitExceeded',
]);

export interface RequestSpec {
  /** Nama operasi untuk log (tanpa data pengguna). */
  op: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Harus dapat dikirim ulang (bukan aliran). */
  body?: Uint8Array | string;
  /** Aman diulang pada 429/5xx/galat jaringan (baca, daftar, hapus, rename, izin). Pembuatan berkas: false. */
  idempotent: boolean;
  timeoutMs?: number;
  /**
   * Unduhan berbadan besar: `timeoutMs` hanya membatasi sampai HEADER respons diterima; badan lalu mengalir tanpa
   * batas waktu total (jaringan lambat tak memotong unduhan di tengah). Pembatalan oleh klien (aliran dibatalkan)
   * tetap menghentikan permintaan. Default: batas waktu mencakup seluruh badan.
   */
  streamBody?: boolean;
}

export interface GoogleHttp {
  /**
   * Mengirim permintaan bertoken. 401 -> token diperbarui SEKALI lalu diulang (401 kedua = UNAVAILABLE);
   * 429/5xx/403 rate-limit/galat jaringan diulang bertahap HANYA bila `idempotent`. Respons lain (termasuk 4xx dan
   * 5xx yang sudah habis diulang) dikembalikan untuk ditafsirkan pemanggil lewat `failResponse`.
   */
  request(spec: RequestSpec): Promise<Response>;
}

export function denied(): Error {
  return appError(
    'UNAVAILABLE',
    'Akses ke Google Drive ditolak (folder atau berkas di luar yang diizinkan, atau izin service account kurang). Hubungi admin.',
  );
}

/** Alasan galat Google yang singkat dan aman dicatat (`notFound`, `forbidden`, ...); selain pola ini dibuang. */
export async function errorReason(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as {
      error?: { errors?: Array<{ reason?: unknown }>; status?: unknown };
    };
    const reason = body.error?.errors?.[0]?.reason ?? body.error?.status;
    return typeof reason === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(reason) ? reason : undefined;
  } catch {
    return undefined;
  }
}

/** Teks galat Google (HANYA untuk pencocokan di kode, tidak pernah dicatat/diteruskan). */
export async function errorText(response: Response): Promise<string> {
  try {
    return await response.clone().text();
  } catch {
    return '';
  }
}

/**
 * Menerjemahkan respons non-sukses yang tak ditangani pemanggil menjadi galat aplikasi. Log hanya memuat nama
 * operasi, status HTTP, dan kode alasan singkat: tidak ada badan respons, header, token, atau kunci.
 */
export async function failResponse(op: string, response: Response): Promise<never> {
  const reason = await errorReason(response);
  console.error(`Google ${op} gagal: HTTP ${response.status}${reason ? ` (${reason})` : ''}`);
  const rateLimited = reason !== undefined && RATE_LIMIT_REASONS.has(reason);
  if (!rateLimited && (response.status === 401 || response.status === 403)) throw denied();
  if (response.status === 404) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  if (response.status === 400) {
    throw appError('VALIDATION', 'Permintaan ke Google tidak valid');
  }
  throw appError('UNAVAILABLE', 'Layanan Google mengalami gangguan. Coba lagi sebentar lagi.');
}

export function createGoogleHttp(options: {
  tokens: TokenProvider;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): GoogleHttp {
  async function isRateLimited(response: Response): Promise<boolean> {
    if (response.status !== 403) return false;
    const reason = await errorReason(response);
    return reason !== undefined && RATE_LIMIT_REASONS.has(reason);
  }

  return {
    async request(spec) {
      let refreshed = false;
      let retries = 0;
      for (;;) {
        const token = await options.tokens.getAccessToken();
        let response: Response;
        const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        let headerTimer: ReturnType<typeof setTimeout> | undefined;
        let signal: AbortSignal;
        if (spec.streamBody) {
          const controller = new AbortController();
          headerTimer = setTimeout(
            () =>
              controller.abort(new DOMException('Batas waktu header terlampaui', 'TimeoutError')),
            timeoutMs,
          );
          signal = controller.signal;
        } else {
          signal = AbortSignal.timeout(timeoutMs);
        }
        try {
          response = await options.fetch(spec.url, {
            method: spec.method,
            headers: { ...spec.headers, authorization: `Bearer ${token}` },
            ...(spec.body === undefined ? {} : { body: spec.body }),
            signal,
          });
          // Header sudah tiba: badan boleh mengalir selama yang diperlukan.
          if (headerTimer !== undefined) clearTimeout(headerTimer);
        } catch (error) {
          if (headerTimer !== undefined) clearTimeout(headerTimer);
          const name = (error as { name?: string } | null)?.name;
          const delay = spec.idempotent ? RETRY_DELAYS_MS[retries] : undefined;
          if (delay !== undefined) {
            retries += 1;
            await options.sleep(delay);
            continue;
          }
          const timedOut = name === 'TimeoutError' || name === 'AbortError';
          console.error(`Google ${spec.op} gagal: ${timedOut ? 'batas waktu' : 'jaringan'}`);
          throw appError(
            'UNAVAILABLE',
            timedOut
              ? 'Layanan Google tidak menjawab (batas waktu terlampaui). Coba lagi sebentar lagi.'
              : 'Layanan Google sedang tidak dapat dihubungi. Coba lagi sebentar lagi.',
          );
        }
        if (response.status === 401) {
          if (refreshed) {
            console.error(`Google ${spec.op} gagal: HTTP 401 setelah token diperbarui`);
            throw denied();
          }
          refreshed = true;
          options.tokens.invalidate(token);
          continue;
        }
        const retryable =
          response.status === 429 || response.status >= 500 || (await isRateLimited(response));
        const delay = retryable && spec.idempotent ? RETRY_DELAYS_MS[retries] : undefined;
        if (delay !== undefined) {
          retries += 1;
          await options.sleep(delay);
          continue;
        }
        return response;
      }
    },
  };
}
