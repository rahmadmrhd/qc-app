// Kabel LAMA khusus aplikasi Apps Script (`gas/`), dipertahankan sampai `gas/` dipensiunkan (Task 35): amplop RPC
// `{ ok, data | error }` dan DTO biner dengan isi berkas base64. Kabel web/server kini REST (`shared/api.ts`) dan
// tidak boleh memakai berkas ini (dijaga `scripts/no-legacy-rpc.test.ts`). Dipakai `RpcContract` (`rpc.ts`) dan
// modul `gas/src` saja.

import type { ErrorCode } from './rpc';

export interface RpcErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  fields?: Record<string, string>;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcErrorBody };

export interface GasUploadFileInput {
  mime: string;
  /** Isi gambar dalam base64 baku (tanpa awalan `data:`). */
  base64: string;
  width: number;
  height: number;
}

export interface GasFileContentDto {
  id: string;
  mime: string;
  base64: string;
}

export interface GasUploadQrPdfInput {
  name: string;
  base64: string;
  replaceDocumentId?: string;
}

export interface GasExportQrDesignInput {
  id: string;
  expectedUpdatedAt: string;
  pdfBase64: string;
  pngBase64: string;
}

export interface GasQrFileDto {
  filename: string;
  mime: string;
  base64: string;
}
