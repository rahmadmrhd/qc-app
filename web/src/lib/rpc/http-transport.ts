import type { ErrorCode } from '@shared/rpc';
import type { RpcTransport } from './transport';

export interface HttpTransportOptions {
  /** Awalan URL (bawaan: origin yang sama). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Header wajib semua permintaan tulis (mitigasi CSRF di Worker). */
export const CSRF_HEADERS = { 'X-Requested-With': 'qc' } as const;

function envelopeText(code: ErrorCode, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message, requestId: '-' } });
}

function looksLikeEnvelope(text: string): boolean {
  try {
    const value = JSON.parse(text) as { ok?: unknown };
    return typeof value === 'object' && value !== null && typeof value.ok === 'boolean';
  } catch {
    return false;
  }
}

/**
 * Transport HTTP ke Worker: `POST /api/rpc` dengan badan `{ method, payload }`; sesi lewat cookie
 * (`credentials: same-origin`), jadi argumen token diabaikan. Worker membalas amplop `{ ok, data | error }`
 * dengan status HTTP sesuai kode galat, jadi badan dibaca walau status bukan 200. Tiap panggilan = satu
 * permintaan (tanpa batching). Galat jaringan dilempar agar klien RPC memetakannya ke INTERNAL.
 */
export function createHttpTransport(options: HttpTransportOptions = {}): RpcTransport {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  return {
    async call(method, payloadJson) {
      const doFetch = options.fetchImpl ?? fetch;
      const response = await doFetch(`${baseUrl}/api/rpc`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
        body: `{"method":${JSON.stringify(method)},"payload":${payloadJson}}`,
      });
      const text = await response.text();
      if (looksLikeEnvelope(text)) return text;
      // Badan bukan amplop (mis. halaman galat Cloudflare): petakan dari status HTTP.
      if (response.status === 401) {
        return envelopeText('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
      }
      if (response.status === 403) return envelopeText('FORBIDDEN', 'Permintaan ditolak');
      if (response.status === 429 || response.status === 503) {
        return envelopeText('UNAVAILABLE', 'Layanan sedang sibuk atau tidak tersedia');
      }
      return text;
    },
  };
}

export const httpTransport: RpcTransport = createHttpTransport();
