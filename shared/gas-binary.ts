// DTO biner KONTRAK APPS SCRIPT (`gas/`): isi berkas lewat base64 di amplop RPC. Hanya dipakai `RpcContract` dan
// modul `gas/src`; kontrak Worker/REST (`WorkerRpcContract`, byte mentah) ada di `rpc.ts`. Berkas ini dihapus
// saat `gas/` dipensiunkan (setelah cutover).

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
