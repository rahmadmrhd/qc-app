/**
 * Log terstruktur untuk Workers Logs (observability di `wrangler.jsonc`).
 *
 * Satu objek per peristiwa lewat `console.log/warn` (bukan string): Workers Logs mengindeks field objek sehingga
 * bisa difilter, mis. `evt = rpc AND ok = false`, atau `ms > 500`. Jangan memasukkan rahasia, isi payload, atau
 * email; `userId` (id internal) cukup untuk melacak. `requestId` sama dengan yang dikirim ke klien pada galat,
 * sehingga laporan pengguna ("requestId a1b2c3d4") langsung bisa dicari.
 */

export interface RequestLog {
  /** `rpc` (POST /api/rpc) atau `sync` (POST /sync, QC Desktop). */
  evt: 'rpc' | 'sync';
  requestId: string;
  method: string;
  ok: boolean;
  /** Kode galat (`VALIDATION`, `FORBIDDEN`, `INTERNAL`, ...) bila `ok = false`. */
  code?: string;
  /** Waktu dinding sejak permintaan diterima, milidetik (CPU ada di invocation log Cloudflare). */
  ms: number;
  userId?: string | null;
}

/** Galat yang wajar dari pemakaian normal (bukan bug server): level `warn`; sisanya `error` sudah dicatat tersendiri. */
const EXPECTED_CODES = new Set([
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNAVAILABLE',
]);

export function logRequest(entry: RequestLog): void {
  const line: Record<string, unknown> = { ...entry };
  if (entry.ok) console.log(line);
  else if (entry.code !== undefined && EXPECTED_CODES.has(entry.code)) console.warn(line);
  else console.error(line);
}
