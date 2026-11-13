import { toErrorBody } from '@server/core/router';
import type { ErrorCode } from '@shared/contract';

// Galat REST berformat RFC 9457 (`application/problem+json`) dengan ekstensi `code`, `requestId`, `fields`.
// `code` tetap kode galat kontrak (FE memutuskan dari `code`, bukan dari status): basi dengan `If-Match` = 412
// tetapi `code` tetap `CONFLICT`.

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode;
  requestId: string;
  fields?: Record<string, string>;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

const TITLE_BY_CODE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Belum masuk',
  FORBIDDEN: 'Akses ditolak',
  NOT_FOUND: 'Tidak ditemukan',
  VALIDATION: 'Input tidak valid',
  CONFLICT: 'Konflik',
  UNAVAILABLE: 'Layanan tidak tersedia',
  INTERNAL: 'Kesalahan server',
};

export interface Problem {
  status: number;
  body: ProblemBody;
  headers?: Record<string, string>;
}

/** `status` eksplisit menimpa status dari kode (412 untuk basi + `If-Match`, 400/413 untuk badan rusak). */
export interface ProblemOptions {
  status?: number;
}

/**
 * Memetakan galat apa pun ke problem+json. Galat tak dikenal disamarkan (`INTERNAL`, pesan umum, hanya
 * `requestId`; detail masuk log lewat `toErrorBody`) dan `DbError` `unavailable` menjadi 503.
 */
export function toProblem(
  error: unknown,
  requestId: string,
  options: ProblemOptions = {},
): Problem {
  const base = toErrorBody(error, requestId);
  const explicit = (error as { status?: unknown } | null)?.status;
  const status =
    options.status ?? (typeof explicit === 'number' ? explicit : STATUS_BY_CODE[base.code]);
  return {
    status,
    body: {
      type: `urn:qc:problem:${base.code.toLowerCase()}`,
      title: status === 412 ? 'Prasyarat gagal' : TITLE_BY_CODE[base.code],
      status,
      detail: base.message,
      code: base.code,
      requestId: base.requestId,
      ...(base.fields ? { fields: base.fields } : {}),
    },
    ...(base.code === 'UNAVAILABLE' ? { headers: { 'retry-after': '5' } } : {}),
  };
}

export function problemResponse(problem: Problem): Response {
  return new Response(JSON.stringify(problem.body), {
    status: problem.status,
    headers: {
      'content-type': PROBLEM_CONTENT_TYPE,
      'cache-control': 'no-store',
      ...problem.headers,
    },
  });
}
