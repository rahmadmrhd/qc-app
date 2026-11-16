import type { Env } from './env';
import { appError, isAppError } from './errors';
import { createGoogleClient } from './google/client';

export interface BridgeFile {
  mime: string;
  base64: string;
}

export interface BridgeFileInfo {
  mime: string;
  size: number;
}

export interface BridgeExternalFileInfo extends BridgeFileInfo {
  name: string;
}

/** Potongan ekspor MariaDB -> Spreadsheet (job `exports.sheets`). */
export interface SheetsExportChunk {
  sheet: string;
  columns: string[];
  rows: string[][];
  /** `replace` menimpa sheet (potongan pertama), `append` menambah baris. */
  mode: 'replace' | 'append';
}

/** Hasil `sheetsDump`: nama sheet -> baris (baris pertama = nama kolom). */
export type SheetsDump = Record<string, string[][]>;

/** Satu entri hasil `listFolder` (berkas yang tidak di tempat sampah). */
export interface DriveFolderEntry {
  id: string;
  name: string;
  mime: string;
  size: number;
  md5Checksum?: string;
  createdTime?: string;
  modifiedTime?: string;
  appProperties: Record<string, string>;
}

export interface DriveFolderPage {
  files: DriveFolderEntry[];
  /** Ada bila masih ada halaman berikutnya. */
  nextPageToken?: string;
}

export interface DriveUploadResult {
  id: string;
  size: number;
  /** MD5 hasil hitung Drive (untuk verifikasi integritas terhadap hash lokal). */
  md5Checksum: string;
}

export interface DriveDownload {
  mime: string;
  size: number;
  body: ReadableStream<Uint8Array>;
}

export interface DriveStorageQuota {
  /** Batas kuota dalam byte; `null` = tak terbatas. */
  limit: number | null;
  usage: number;
}

/**
 * Batas ke Google (Drive v3 dan Sheets v4). Implementasi nyata: `createGoogleClient` (`core/google/`, service
 * account lewat `fetch`; menggantikan jembatan Apps Script di T30a). Tes memakai `createFakeBridge()`
 * (server/test-support/fake-bridge.ts). Nama `BridgeClient` dipertahankan agar modul pemanggil tak berubah.
 */
export interface BridgeClient {
  /** Folder baru SELALU di bawah folder induk (`GOOGLE_ROOT_FOLDER_ID`). */
  createFolder(name: string): Promise<string>;
  createFile(folderId: string, name: string, mime: string, base64: string): Promise<string>;
  /**
   * Seperti `createFile` tetapi dari byte/Blob (berkas besar: resumable; tanpa base64) dan mengembalikan ukuran
   * serta MD5 dari Drive. `appProperties` menyimpan metadata kecil (mis. SHA-256 cadangan).
   */
  uploadFile(
    folderId: string,
    name: string,
    mime: string,
    source: Uint8Array | Blob,
    options?: { appProperties?: Record<string, string> },
  ): Promise<DriveUploadResult>;
  /** `null` bila tak ada atau tak terbaca. Berkas yang bukan anak `folderId` = galat akses (bukan `null`). */
  readFile(fileId: string, folderId: string): Promise<BridgeFile | null>;
  /** Seperti `readFile` tetapi mengalirkan isi (cadangan besar); `null` bila tak ada. */
  downloadFile(fileId: string, folderId: string): Promise<DriveDownload | null>;
  /** `null` bila tak ada, tak terbaca, atau di tempat sampah. Bukan anak `folderId` = galat akses. */
  fileInfo(fileId: string, folderId: string): Promise<BridgeFileInfo | null>;
  folderExists(folderId: string): Promise<boolean>;
  /** Daftar berkas (bukan sampah) dalam folder yang diizinkan, berhalaman (urut nama); `name` = hanya yang bernama persis itu. */
  listFolder(
    folderId: string,
    options?: { pageSize?: number; pageToken?: string; name?: string },
  ): Promise<DriveFolderPage>;
  /** Aman bila berkas tidak ada. */
  trashFile(fileId: string): Promise<void>;
  /** Hapus PERMANEN berkas buatan sendiri (dimiliki service account) di folder yang diizinkan; aman bila tak ada. */
  deleteFile(fileId: string): Promise<void>;
  externalFileInfo(fileId: string, resourceKey?: string): Promise<BridgeExternalFileInfo | null>;
  readExternalFile(fileId: string, resourceKey?: string): Promise<BridgeFile | null>;
  copyFile(fileId: string, folderId: string, name: string, resourceKey?: string): Promise<string>;
  renameFile(fileId: string, name: string): Promise<void>;
  shareAnyoneWithLink(fileId: string): Promise<void>;
  /** Sukses bila berkas tidak ada. */
  revokeSharing(fileId: string): Promise<void>;
  replaceFileContent(fileId: string, mime: string, base64: string): Promise<void>;
  /** Kuota penyimpanan akun service account (untuk pemantauan 15 GB). */
  storageQuota(): Promise<DriveStorageQuota>;
  sheetsExport(chunk: SheetsExportChunk): Promise<void>;
  /** `sheets` membatasi nama sheet yang diambil (bawaan: semua sheet sumber). */
  sheetsDump(sheets?: string[]): Promise<SheetsDump>;
}

/** Klien Google untuk permintaan ini: `env.BRIDGE` (disuntik `createServer`/tes) atau klien baru dari `env`. */
export function getBridge(env: Env): BridgeClient {
  return env.BRIDGE ?? createGoogleClient(env);
}

/**
 * Menjalankan panggilan Google; kegagalan apa pun yang bukan galat aplikasi (jaringan, kuota, token ditolak)
 * dicatat lalu dilaporkan ke pengguna sebagai `UNAVAILABLE` yang jelas.
 */
export async function viaBridge<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isAppError(error)) throw error;
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`Klien Google gagal: ${detail}`);
    throw appError(
      'UNAVAILABLE',
      'Layanan Google Drive sedang tidak dapat dihubungi. Coba lagi sebentar lagi.',
    );
  }
}
