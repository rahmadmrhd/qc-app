/** Metadata berkas Drive yang dibutuhkan pemeriksaan induk/tempat sampah. */
export interface BridgeFileMeta {
  parentIds: string[];
  trashed: boolean;
  mime: string;
  size: number;
  name: string;
}

export interface BridgeRangeLike {
  setValues(values: string[][]): unknown;
  setNumberFormat(format: string): unknown;
}

export interface BridgeSheetLike {
  getLastRow(): number;
  getRange(row: number, column: number, numRows: number, numColumns: number): BridgeRangeLike;
  clearContents(): unknown;
  /** Nilai seluruh sheet; sel kosong = ''. Tanggal sudah diubah ke ISO UTC oleh platform. */
  dataValues(): string[][];
}

export interface BridgeSpreadsheetLike {
  sheetNames(): string[];
  getSheetByName(name: string): BridgeSheetLike | null;
  insertSheet(name: string): BridgeSheetLike;
}

/** Semua akses ke API GAS jembatan lewat antarmuka ini (diuji dengan platform memori). */
export interface BridgePlatform {
  getProperty(key: string): string | null;
  cacheGet(key: string): string | null;
  cachePut(key: string, value: string, ttlSeconds: number): void;
  hmacSha256Hex(data: string, secret: string): string;
  now(): number;
  logError(message: string): void;
  withLock<T>(fn: () => T): T;
  spreadsheet(id: string): BridgeSpreadsheetLike;
  driveCreateFolder(name: string): string;
  driveCreateFile(folderId: string, name: string, mime: string, base64: string): string;
  /** `null` bila berkas tidak ada atau tidak terbaca. */
  driveFileMeta(fileId: string): BridgeFileMeta | null;
  driveReadBase64(fileId: string): { mime: string; base64: string } | null;
  driveFolderMeta(folderId: string): { trashed: boolean } | null;
  driveTrashFile(fileId: string): void;
  driveExternalFileInfo(
    fileId: string,
    resourceKey?: string,
  ): { name: string; mime: string; size: number } | null;
  driveReadExternalFile(
    fileId: string,
    resourceKey?: string,
  ): { mime: string; base64: string } | null;
  driveCopyFile(fileId: string, folderId: string, name: string, resourceKey?: string): string;
  driveRenameFile(fileId: string, name: string): void;
  driveShareAnyoneWithLink(fileId: string): void;
  driveRevokeSharing(fileId: string): void;
  driveReplaceFileContent(fileId: string, mime: string, base64: string): void;
}

let currentBridgePlatform_: BridgePlatform | null = null;

export function setBridgePlatform_(platform: BridgePlatform | null): void {
  currentBridgePlatform_ = platform;
}

export function bridgePlatform_(): BridgePlatform {
  if (!currentBridgePlatform_) throw new Error('Platform jembatan belum diinisialisasi');
  return currentBridgePlatform_;
}
