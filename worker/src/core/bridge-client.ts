import type { Env } from './env';

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

/** Potongan ekspor D1 -> Spreadsheet (aksi `sheets.export`; bentuk final ditetapkan Task 3.4). */
export interface SheetsExportChunk {
  sheet: string;
  columns: string[];
  rows: string[][];
  /** `replace` menimpa sheet (potongan pertama), `append` menambah baris. */
  mode: 'replace' | 'append';
}

/** Hasil `sheets.dump`: nama sheet -> baris (baris pertama = nama kolom). */
export type SheetsDump = Record<string, string[][]>;

/**
 * Klien jembatan Apps Script. Memetakan satu-ke-satu antarmuka Drive di `gas/src/core/platform.ts`
 * (semua `Promise`), ditambah aksi Sheets. Implementasi nyata (HMAC + fetch): Task 3.2;
 * tes memakai `createFakeBridge()` (worker/test-support/fake-bridge.ts).
 */
export interface BridgeClient {
  createFolder(name: string): Promise<string>;
  createFile(folderId: string, name: string, mime: string, base64: string): Promise<string>;
  /** `null` bila tak ada, tak terbaca, atau bukan anak `folderId`. */
  readFile(fileId: string, folderId: string): Promise<BridgeFile | null>;
  /** `null` bila tak ada, tak terbaca, di tempat sampah, atau bukan anak `folderId`. */
  fileInfo(fileId: string, folderId: string): Promise<BridgeFileInfo | null>;
  folderExists(folderId: string): Promise<boolean>;
  /** Aman bila berkas tidak ada. */
  trashFile(fileId: string): Promise<void>;
  externalFileInfo(fileId: string, resourceKey?: string): Promise<BridgeExternalFileInfo | null>;
  readExternalFile(fileId: string, resourceKey?: string): Promise<BridgeFile | null>;
  copyFile(fileId: string, folderId: string, name: string, resourceKey?: string): Promise<string>;
  renameFile(fileId: string, name: string): Promise<void>;
  shareAnyoneWithLink(fileId: string): Promise<void>;
  /** Sukses bila berkas tidak ada. */
  revokeSharing(fileId: string): Promise<void>;
  replaceFileContent(fileId: string, mime: string, base64: string): Promise<void>;
  sheetsExport(chunk: SheetsExportChunk): Promise<void>;
  sheetsDump(): Promise<SheetsDump>;
}

/** Klien jembatan untuk permintaan ini; implementasi nyata menyusul di Task 3.2. */
export function getBridge(env: Env): BridgeClient {
  if (env.BRIDGE) return env.BRIDGE;
  throw new Error('BridgeClient belum diimplementasikan (Task 3.2)');
}
