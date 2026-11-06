import type { BridgePlatform, BridgeSheetLike, BridgeSpreadsheetLike } from './platform';
import { setBridgePlatform_ } from './platform';

function cellText_(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function wrapSheet_(sheet: GoogleAppsScript.Spreadsheet.Sheet): BridgeSheetLike {
  return {
    getLastRow: () => sheet.getLastRow(),
    getRange: (row, column, numRows, numColumns) =>
      sheet.getRange(row, column, numRows, numColumns),
    clearContents: () => sheet.clearContents(),
    dataValues: () => {
      if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
      return sheet
        .getDataRange()
        .getValues()
        .map((row) => row.map(cellText_));
    },
  };
}

function wrapSpreadsheet_(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
): BridgeSpreadsheetLike {
  return {
    sheetNames: () => spreadsheet.getSheets().map((sheet) => sheet.getName()),
    getSheetByName: (name) => {
      const sheet = spreadsheet.getSheetByName(name);
      return sheet ? wrapSheet_(sheet) : null;
    },
    insertSheet: (name) => wrapSheet_(spreadsheet.insertSheet(name)),
  };
}

function fileOrNull_(fileId: string, resourceKey?: string): GoogleAppsScript.Drive.File | null {
  try {
    return resourceKey
      ? DriveApp.getFileByIdAndResourceKey(fileId, resourceKey)
      : DriveApp.getFileById(fileId);
  } catch {
    return null;
  }
}

function createGasBridgePlatform_(): BridgePlatform {
  const properties = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  return {
    getProperty: (key) => properties.getProperty(key),
    cacheGet: (key) => cache.get(key),
    cachePut: (key, value, ttlSeconds) => cache.put(key, value, ttlSeconds),
    hmacSha256Hex: (data, secret) =>
      Utilities.computeHmacSha256Signature(data, secret, Utilities.Charset.UTF_8)
        .map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0'))
        .join(''),
    now: () => Date.now(),
    logError: (message) => console.error(message),
    withLock<T>(fn: () => T): T {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        return fn();
      } finally {
        SpreadsheetApp.flush();
        lock.releaseLock();
      }
    },
    spreadsheet: (id) => wrapSpreadsheet_(SpreadsheetApp.openById(id)),
    driveCreateFolder: (name) => DriveApp.createFolder(name).getId(),
    driveCreateFile: (folderId, name, mime, base64) => {
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
      return DriveApp.getFolderById(folderId).createFile(blob).getId();
    },
    driveFileMeta: (fileId) => {
      const file = fileOrNull_(fileId);
      if (!file) return null;
      try {
        const parentIds: string[] = [];
        const parents = file.getParents();
        while (parents.hasNext()) parentIds.push(parents.next().getId());
        return {
          parentIds,
          trashed: file.isTrashed(),
          mime: file.getMimeType(),
          size: file.getSize(),
          name: file.getName(),
        };
      } catch {
        return null;
      }
    },
    driveReadBase64: (fileId) => {
      const file = fileOrNull_(fileId);
      if (!file) return null;
      try {
        const blob = file.getBlob();
        return {
          mime: blob.getContentType() ?? '',
          base64: Utilities.base64Encode(blob.getBytes()),
        };
      } catch {
        return null;
      }
    },
    driveFolderMeta: (folderId) => {
      try {
        return { trashed: DriveApp.getFolderById(folderId).isTrashed() };
      } catch {
        return null;
      }
    },
    driveTrashFile: (fileId) => {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch {
        // Berkas sudah tidak ada: tidak ada yang perlu dibuang.
      }
    },
    driveExternalFileInfo: (fileId, resourceKey) => {
      const file = fileOrNull_(fileId, resourceKey);
      if (!file) return null;
      try {
        return { name: file.getName(), mime: file.getMimeType(), size: file.getSize() };
      } catch {
        return null;
      }
    },
    driveReadExternalFile: (fileId, resourceKey) => {
      const file = fileOrNull_(fileId, resourceKey);
      if (!file) return null;
      try {
        const blob = file.getBlob();
        return {
          mime: blob.getContentType() ?? '',
          base64: Utilities.base64Encode(blob.getBytes()),
        };
      } catch {
        return null;
      }
    },
    driveCopyFile: (fileId, folderId, name, resourceKey) =>
      (resourceKey
        ? DriveApp.getFileByIdAndResourceKey(fileId, resourceKey)
        : DriveApp.getFileById(fileId)
      )
        .makeCopy(name, DriveApp.getFolderById(folderId))
        .getId(),
    driveRenameFile: (fileId, name) => {
      DriveApp.getFileById(fileId).setName(name);
    },
    driveShareAnyoneWithLink: (fileId) => {
      DriveApp.getFileById(fileId).setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW,
      );
    },
    driveRevokeSharing: (fileId) => {
      DriveApp.getFileById(fileId).setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    },
    driveReplaceFileContent: (fileId, mime, base64) => {
      // DriveApp tidak bisa mengganti isi berkas biner; Drive API v3 (scope drive yang sama) bisa.
      const response = UrlFetchApp.fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`,
        {
          method: 'patch',
          contentType: mime,
          payload: Utilities.base64Decode(base64),
          headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
          muteHttpExceptions: true,
        },
      );
      const status = response.getResponseCode();
      if (status < 200 || status >= 300) {
        throw new Error(`Drive API ${status}: ${response.getContentText().slice(0, 200)}`);
      }
    },
  };
}

export function installGasBridgePlatform_(): void {
  setBridgePlatform_(createGasBridgePlatform_());
}

/** `setup` hanya boleh dijalankan pemilik script dari editor, bukan oleh pemanggil luar. */
export function assertBridgeOwner_(): void {
  const active = Session.getActiveUser().getEmail();
  if (active === '' || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('setup hanya boleh dijalankan oleh pemilik script dari editor Apps Script.');
  }
}
