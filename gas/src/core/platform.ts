export interface RangeLike {
  getValues(): unknown[][];
  setValues(values: unknown[][]): unknown;
  /** Format angka/teks sel; '@' = teks biasa (nilai tidak ditafsirkan ulang sebagai angka, tanggal, atau formula). */
  setNumberFormat(format: string): unknown;
}

export interface SheetLike {
  getLastRow(): number;
  getLastColumn(): number;
  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike;
  /** Notasi A1, mis. `A:K` = seluruh kolom A sampai K (termasuk baris yang akan datang). */
  getRange(a1Notation: string): RangeLike;
  /** Seluruh data sheet (dari A1 sampai sel terakhir berisi) dalam satu panggilan; sheet kosong = `[['']]`. */
  getDataRange(): RangeLike;
  getMaxRows(): number;
  insertRowsAfter(afterPosition: number, howMany: number): unknown;
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
  /** Menyimpan Script Property (dipakai `setup` untuk id folder Drive). */
  setProperty(key: string, value: string): void;
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
  /** Membuat folder Drive (privat) di akar Drive pemilik script; mengembalikan id folder. */
  driveCreateFolder(name: string): string;
  /** Menyimpan berkas (isi base64) ke folder; mengembalikan id berkas Drive. */
  driveCreateFile(folderId: string, name: string, mime: string, base64: string): string;
  /** Membaca berkas Drive sebagai base64; `null` bila tidak ditemukan, tidak terbaca, atau bukan anak `folderId`. */
  driveReadFile(fileId: string, folderId: string): { mime: string; base64: string } | null;
  /** Info berkas Drive tanpa membaca isinya; `null` bila tak ada, tak terbaca, di tempat sampah, atau bukan anak `folderId`. */
  driveFileInfo(fileId: string, folderId: string): { mime: string; size: number } | null;
  /** True bila folder ada dan tidak berada di tempat sampah. */
  driveFolderExists(folderId: string): boolean;
  /** Membuang berkas Drive (ke tempat sampah); aman bila berkas tidak ada. */
  driveTrashFile(fileId: string): void;
  /** Info berkas Drive mana pun yang dapat dibaca pemilik script; null bila tidak ada/tidak dapat diakses. */
  driveExternalFileInfo(
    fileId: string,
    resourceKey?: string,
  ): { name: string; mime: string; size: number } | null;
  /** Membaca isi berkas Drive mana pun yang dapat dibaca pemilik script (base64); null bila tidak terbaca. */
  driveReadExternalFile(
    fileId: string,
    resourceKey?: string,
  ): { mime: string; base64: string } | null;
  /** Menyalin berkas ke folder (berkas asli tidak diubah); mengembalikan id salinan. Melempar bila gagal. */
  driveCopyFile(fileId: string, folderId: string, name: string, resourceKey?: string): string;
  /** Mengganti nama berkas Drive. Melempar bila berkas tidak ada. */
  driveRenameFile(fileId: string, name: string): void;
  /** Membagikan berkas "siapa saja yang punya link: hanya lihat". Melempar bila berkas tidak ada. */
  driveShareAnyoneWithLink(fileId: string): void;
  /** Mencabut berbagi publik berkas (kembali privat). Sukses bila berkas tidak ada; galat lain dilempar. */
  driveRevokeSharing(fileId: string): void;
  /** Mengganti isi berkas yang ada (id tetap, sehingga URL berbagi tidak berubah). Melempar bila gagal. */
  driveReplaceFileContent(fileId: string, mime: string, base64: string): void;
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

/**
 * Cache baca tabel selama SATU permintaan (RPC/sinkronisasi). Tiap panggilan Sheets di Apps Script berbiaya
 * ratusan ms dan handler sering membaca tabel yang sama berulang kali. Di luar `withRequestCache_` (mis. tes yang
 * memanggil repo langsung) cache nonaktif. Dibersihkan saat masuk/keluar lock dan pada setiap tulis (lihat core/db).
 */
let requestCache_: Map<string, unknown> | null = null;

export function withRequestCache_<T>(fn: () => T): T {
  // Bersarang (mis. item batch di dalam permintaan batch): memakai cache luar agar pembacaan dibagi.
  if (requestCache_) return fn();
  const previous = requestCache_;
  requestCache_ = new Map();
  try {
    return fn();
  } finally {
    requestCache_ = previous;
  }
}

export function requestCache_get_(key: string): unknown {
  return requestCache_?.get(key);
}

export function requestCache_set_(key: string, value: unknown): void {
  requestCache_?.set(key, value);
}

export function requestCache_delete_(key: string): void {
  requestCache_?.delete(key);
}

/**
 * Membuang cache ISI tabel (dipanggil platform saat lock diambil/dilepas agar pembacaan di dalam lock selalu segar).
 * Cache sheet+header (kunci "open:") dipertahankan: header hanya berubah lewat openTable_ yang memperbaruinya sendiri.
 */
export function clearRequestCache_(): void {
  if (!requestCache_) return;
  for (const key of [...requestCache_.keys()]) {
    if (!key.startsWith('open:')) requestCache_.delete(key);
  }
}
