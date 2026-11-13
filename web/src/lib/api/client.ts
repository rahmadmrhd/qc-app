import {
  API_ROUTES,
  type ApiVerb,
  downloadOutput,
  formatEtag,
  type RequestParts,
  toRequestParts,
} from '@shared/api';
import {
  type ApiId,
  type ApiInput,
  type ApiOutput,
  ERROR_CODES,
  type ErrorCode,
} from '@shared/contract';
import { beginBusy } from '@/app/pwa/busy';
import { ApiError } from './api-error';

/** Awalan jalur REST; jalur tabel (`/brands/{id}`) relatif terhadapnya. */
export const API_BASE = '/api/v1';
/** Header wajib semua permintaan tulis (mitigasi CSRF di server). */
export const CSRF_HEADERS = { 'X-Requested-With': 'qc' } as const;

export interface ApiClientOptions {
  /** Awalan URL sebelum `/api/v1` (bawaan: origin yang sama). */
  baseUrl?: string;
  /** Bawaan: `fetch` global dipilih saat panggilan (tes dapat menggantinya lewat `vi.stubGlobal`). */
  fetchImpl?: typeof fetch;
}

/** Opsi per panggilan (hanya untuk jalur yang membutuhkan; panggilan biasa tak memakainya). */
export interface ApiCallOptions {
  /** Pembatal permintaan (mis. batas waktu pengurasan antrean). Abort dipetakan ke `UNAVAILABLE` seperti galat jaringan. */
  signal?: AbortSignal;
}

export type ApiCall = <M extends ApiId>(
  id: M,
  input: ApiInput<M>,
  options?: ApiCallOptions,
) => Promise<ApiOutput<M>>;

interface ProblemShape {
  code: ErrorCode;
  detail?: string;
  title?: string;
  requestId?: string;
  fields?: Record<string, string>;
}

function isProblem(value: unknown): value is ProblemShape {
  if (typeof value !== 'object' || value === null) return false;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Galat dari respons non-2xx: problem+json bila ada, selain itu dipetakan dari status (halaman galat proksi). */
function errorFromResponse(status: number, text: string): ApiError {
  const body = parseJson(text);
  if (isProblem(body)) {
    // 412 (If-Match basi) tetap `CONFLICT` agar penanganan di UI tidak berubah.
    const code: ErrorCode = status === 412 ? 'CONFLICT' : body.code;
    return new ApiError(
      code,
      body.detail ?? body.title ?? 'Terjadi kesalahan pada server',
      typeof body.requestId === 'string' ? body.requestId : '-',
      body.fields,
      { status },
    );
  }
  if (status === 401) {
    return new ApiError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir', '-', undefined, {
      status,
    });
  }
  if (status === 403)
    return new ApiError('FORBIDDEN', 'Permintaan ditolak', '-', undefined, { status });
  // Bun.serve memutus badan di atas batas dengan 413 polos sebelum aplikasi berjalan (tanpa problem+json).
  if (status === 413) {
    return new ApiError('VALIDATION', 'Badan permintaan terlalu besar', '-', undefined, { status });
  }
  if (status === 429 || status === 503) {
    return new ApiError('UNAVAILABLE', 'Layanan sedang sibuk atau tidak tersedia', '-', undefined, {
      status,
    });
  }
  return new ApiError('INTERNAL', 'Respons server tidak valid', '-', undefined, { status });
}

function urlOf(baseUrl: string, parts: RequestParts): string {
  const query = new URLSearchParams(parts.query).toString();
  return `${baseUrl}${API_BASE}${parts.path}${query === '' ? '' : `?${query}`}`;
}

function headersOf(verb: ApiVerb, parts: RequestParts, download: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: download ? '*/*' : 'application/json' };
  if (verb !== 'GET') Object.assign(headers, CSRF_HEADERS);
  if (parts.body !== undefined) headers['Content-Type'] = 'application/json';
  // Badan mentah: jenis isinya dari rute. Multipart: biarkan peramban memberi Content-Type beserta boundary.
  if (parts.raw !== undefined) headers['Content-Type'] = parts.raw.contentType;
  if (parts.ifMatch !== undefined) headers['If-Match'] = formatEtag(parts.ifMatch);
  return headers;
}

/** Badan permintaan: JSON, byte mentah (Blob), atau multipart/form-data. */
function bodyOf(parts: RequestParts): string | Blob | FormData | undefined {
  if (parts.raw !== undefined) {
    return new Blob([parts.raw.data as BlobPart], { type: parts.raw.contentType });
  }
  if (parts.multipart !== undefined) {
    const form = new FormData();
    for (const [name, data] of Object.entries(parts.multipart)) {
      form.append(name, new Blob([data as BlobPart]), `${name}.bin`);
    }
    return form;
  }
  return parts.body === undefined ? undefined : JSON.stringify(parts.body);
}

/**
 * Klien REST bertipe berbasis tabel rute `shared/api.ts`: `api(id, input)` merakit verba, jalur, query, badan,
 * dan `If-Match` dari input datar (bentuk input/keluaran sama dengan kabel lama, jadi `queries.ts` hampir tak
 * berubah). Sesi lewat cookie (`credentials: same-origin`). Galat dipetakan ke `ApiError` dari `code` problem+json.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiCall {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  // Permintaan tulis menandai registri "sibuk" selama berjalan: muat ulang otomatis (PWA) tidak boleh memotongnya.
  async function call<M extends ApiId>(
    id: M,
    input: ApiInput<M>,
    callOptions?: ApiCallOptions,
  ): Promise<ApiOutput<M>> {
    const parts = toRequestParts(id, input);
    const end = parts.verb === 'GET' ? undefined : beginBusy();
    try {
      return await perform(id, input, parts, callOptions);
    } finally {
      end?.();
    }
  }
  async function perform<M extends ApiId>(
    id: M,
    input: ApiInput<M>,
    parts: RequestParts,
    callOptions?: ApiCallOptions,
  ): Promise<ApiOutput<M>> {
    const isDownload = API_ROUTES[id].download !== undefined;
    const doFetch = options.fetchImpl ?? fetch;
    let response: Response;
    let text = '';
    let bytes: Uint8Array | undefined;
    try {
      response = await doFetch(urlOf(baseUrl, parts), {
        method: parts.verb,
        credentials: 'same-origin',
        // JSON jangan pernah dilayani dari cache HTTP peramban (ETag updatedAt bukan validator isi); unduhan biner
        // mengikuti kebijakan Cache-Control server (immutable/revalidate).
        ...(isDownload ? {} : { cache: 'no-store' as const }),
        headers: headersOf(parts.verb, parts, isDownload),
        body: bodyOf(parts),
        ...(callOptions?.signal ? { signal: callOptions.signal } : {}),
      });
      // Unduhan sukses = byte mentah; selain itu teks (JSON atau problem+json).
      if (isDownload && response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      else text = await response.text();
    } catch (error) {
      // Offline, DNS gagal, atau badan terputus: server tidak terjangkau (FR-P15); UI menampilkan data terakhir/antrean.
      throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-', undefined, { cause: error });
    }
    if (!response.ok) throw errorFromResponse(response.status, text);
    if (bytes !== undefined) return downloadOutput(id, input, response.headers, bytes);
    if (text === '') return undefined as unknown as ApiOutput<M>;
    const data = parseJson(text);
    if (data === undefined) throw new ApiError('INTERNAL', 'Respons server tidak valid', '-');
    return data as ApiOutput<M>;
  }
  return call;
}

/** Klien bawaan (origin yang sama). */
export const api: ApiCall = createApiClient();
