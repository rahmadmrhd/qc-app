import type { ErrorCode } from '@shared/rpc';

/** Status HTTP bawaan per kode galat (dipakai bila galat dibuat tanpa respons HTTP, mis. transport lama). */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface ApiErrorOptions extends ErrorOptions {
  /** Status HTTP sebenarnya; bila kosong diturunkan dari `code`. */
  status?: number;
}

/**
 * Galat panggilan API. Keputusan UI memakai `code` (bukan `status`): 412 `If-Match` basi tetap `CONFLICT`.
 * `requestId` = `-` bila galat tidak berasal dari server (jaringan, halaman galat proksi).
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly fields: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    requestId: string,
    fields?: Record<string, string>,
    options?: ApiErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = options?.status ?? STATUS_BY_CODE[code];
    this.requestId = requestId;
    this.fields = fields;
  }
}
