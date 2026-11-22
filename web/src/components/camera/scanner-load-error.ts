/** Galat pemuat pemindai (WASM gagal diunduh/dikompilasi), dibedakan dari galat kamera. */
export class ScannerLoadError extends Error {
  constructor(cause?: unknown) {
    super('Pemindai gagal dimuat');
    this.name = 'ScannerLoadError';
    this.cause = cause;
  }
}
