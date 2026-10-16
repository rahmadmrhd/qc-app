import type { Platform, SpreadsheetLike } from './platform';
import { clearRequestCache_, setPlatform_ } from './platform';
import { finishLockWrites_ } from './table-cache';

function stripBase64Padding_(value: string): string {
  return value.replace(/=+$/, '');
}

function padBase64_(value: string): string {
  return value + '='.repeat((4 - (value.length % 4)) % 4);
}

function createGasPlatform_(): Platform {
  const properties = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  let spreadsheet: SpreadsheetLike | null = null;
  return {
    getProperty: (key) => properties.getProperty(key),
    setProperty: (key, value) => {
      properties.setProperty(key, value);
    },
    scriptUrl: () => ScriptApp.getService().getUrl() ?? '',
    cacheGet: (key) => cache.get(key),
    cachePut: (key, value, ttlSeconds) => cache.put(key, value, ttlSeconds),
    cacheRemove: (key) => cache.remove(key),
    hmacSha256Base64Url: (data, secret) =>
      stripBase64Padding_(
        Utilities.base64EncodeWebSafe(
          Utilities.computeHmacSha256Signature(data, secret, Utilities.Charset.UTF_8),
        ),
      ),
    base64UrlEncode: (text) =>
      stripBase64Padding_(Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8)),
    base64UrlDecode: (encoded) =>
      Utilities.newBlob(
        Utilities.base64DecodeWebSafe(padBase64_(encoded), Utilities.Charset.UTF_8),
      ).getDataAsString('UTF-8'),
    uuid: () => Utilities.getUuid(),
    now: () => Date.now(),
    httpPostForm: (url, form) => {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        payload: form,
        muteHttpExceptions: true,
      });
      return { status: response.getResponseCode(), body: response.getContentText() };
    },
    withLock<T>(fn: () => T): T {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      // Pembacaan di dalam lock harus segar: tulisan eksekusi lain sebelum lock diambil tidak boleh tertutup cache.
      clearRequestCache_();
      try {
        return fn();
      } finally {
        clearRequestCache_();
        SpreadsheetApp.flush();
        // Versi cache tabel diganti SETELAH flush dan sebelum lock dilepas (lihat core/table-cache).
        finishLockWrites_();
        lock.releaseLock();
      }
    },
    flush: () => SpreadsheetApp.flush(),
    spreadsheet: () => {
      if (!spreadsheet) {
        const id = properties.getProperty('SPREADSHEET_ID')?.trim();
        if (!id) throw new Error('Script Property SPREADSHEET_ID belum diset');
        spreadsheet = SpreadsheetApp.openById(id) as unknown as SpreadsheetLike;
      }
      return spreadsheet;
    },
    driveCreateFolder: (name) => DriveApp.createFolder(name).getId(),
    driveCreateFile: (folderId, name, mime, base64) => {
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, name);
      return DriveApp.getFolderById(folderId).createFile(blob).getId();
    },
    driveReadFile: (fileId, folderId) => {
      try {
        const file = DriveApp.getFileById(fileId);
        const parents = file.getParents();
        let inFolder = false;
        while (parents.hasNext()) {
          if (parents.next().getId() === folderId) inFolder = true;
        }
        if (!inFolder) return null;
        const blob = file.getBlob();
        return {
          mime: blob.getContentType() ?? '',
          base64: Utilities.base64Encode(blob.getBytes()),
        };
      } catch {
        return null;
      }
    },
    driveFileInfo: (fileId, folderId) => {
      try {
        const file = DriveApp.getFileById(fileId);
        if (file.isTrashed()) return null;
        const parents = file.getParents();
        let inFolder = false;
        while (parents.hasNext()) {
          if (parents.next().getId() === folderId) inFolder = true;
        }
        if (!inFolder) return null;
        return { mime: file.getMimeType(), size: file.getSize() };
      } catch {
        return null;
      }
    },
    driveFolderExists: (folderId) => {
      try {
        return !DriveApp.getFolderById(folderId).isTrashed();
      } catch {
        return false;
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
      try {
        // Link berbagi berkunci (pembaruan keamanan Drive) wajib menyertakan resource key.
        const file = resourceKey
          ? DriveApp.getFileByIdAndResourceKey(fileId, resourceKey)
          : DriveApp.getFileById(fileId);
        return { name: file.getName(), mime: file.getMimeType(), size: file.getSize() };
      } catch {
        return null;
      }
    },
    driveReadExternalFile: (fileId, resourceKey) => {
      try {
        const file = resourceKey
          ? DriveApp.getFileByIdAndResourceKey(fileId, resourceKey)
          : DriveApp.getFileById(fileId);
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
      let file: GoogleAppsScript.Drive.File;
      try {
        file = DriveApp.getFileById(fileId);
      } catch (error) {
        // Hanya "berkas tidak ada" yang dianggap sukses; galat lain (kuota, izin, sementara) harus naik
        // agar pemanggil tidak menandai berkas sebagai sudah privat.
        if (/no item with the given id|could not be found|not found/i.test(String(error))) return;
        throw error;
      }
      file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
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
    logError: (message) => console.error(message),
  };
}

export function installGasPlatform_(): void {
  setPlatform_(createGasPlatform_());
}

export function loadIndexHtml_(): string {
  return HtmlService.createHtmlOutputFromFile('index').getContent();
}

export function renderHtmlPage_(html: string): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(html)
    .setTitle('QC App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml_(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Rincian error hanya ditampilkan bila `detail` diberikan (pemanggil memastikan hanya untuk pemilik script). */
export function renderErrorPage_(
  message: string,
  detail?: string,
): GoogleAppsScript.HTML.HtmlOutput {
  const detailHtml = detail
    ? `<pre style="white-space:pre-wrap;background:#f4f4f4;padding:1rem">${escapeHtml_(detail)}</pre>`
    : '';
  return HtmlService.createHtmlOutput(
    `<main style="font-family:sans-serif;padding:2rem"><h1>QC App</h1><p>${escapeHtml_(message)}</p>${detailHtml}</main>`,
  ).setTitle('QC App');
}

/** True bila yang mengakses adalah pemilik script (mis. lewat URL /dev). Anonim selalu false. */
export function isScriptOwner_(): boolean {
  const active = Session.getActiveUser().getEmail();
  return active !== '' && active === Session.getEffectiveUser().getEmail();
}

/** `setup` hanya boleh dijalankan pemilik script dari editor, bukan lewat google.script.run. */
export function assertScriptOwner_(): void {
  if (!isScriptOwner_()) {
    throw new Error('setup hanya boleh dijalankan oleh pemilik script dari editor Apps Script.');
  }
}

export function renderJsonOutput_(json: string): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
