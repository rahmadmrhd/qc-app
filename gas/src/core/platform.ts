export interface RangeLike {
  getValues(): unknown[][];
  setValues(values: unknown[][]): unknown;
}

export interface SheetLike {
  getLastRow(): number;
  getLastColumn(): number;
  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike;
  appendRow(values: unknown[]): unknown;
  deleteRow(row: number): unknown;
}

export interface SpreadsheetLike {
  getSheetByName(name: string): SheetLike | null;
  insertSheet(name: string): SheetLike;
}

export interface HttpResponseLike {
  status: number;
  body: string;
}

/** Semua akses ke API GAS lewat antarmuka ini agar logika server bisa diuji tanpa GAS. */
export interface Platform {
  getProperty(key: string): string | null;
  /** URL web app yang sedang melayani permintaan (/dev atau /exec); '' bila tidak tersedia. */
  scriptUrl(): string;
  cacheGet(key: string): string | null;
  cachePut(key: string, value: string, ttlSeconds: number): void;
  cacheRemove(key: string): void;
  hmacSha256Base64Url(data: string, secret: string): string;
  base64UrlEncode(text: string): string;
  base64UrlDecode(encoded: string): string;
  uuid(): string;
  now(): number;
  httpPostForm(url: string, form: Record<string, string>): HttpResponseLike;
  withLock<T>(fn: () => T): T;
  /** Paksa penulisan sheet yang tertunda selesai (dipanggil sebelum lock dilepas). */
  flush(): void;
  spreadsheet(): SpreadsheetLike;
  logError(message: string): void;
}

let currentPlatform_: Platform | null = null;

export function setPlatform_(platform: Platform | null): void {
  currentPlatform_ = platform;
}

export function platform_(): Platform {
  if (!currentPlatform_) throw new Error('Platform belum diinisialisasi');
  return currentPlatform_;
}
