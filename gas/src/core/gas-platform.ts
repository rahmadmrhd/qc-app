import type { Platform, SpreadsheetLike } from './platform';
import { setPlatform_ } from './platform';

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
      try {
        return fn();
      } finally {
        SpreadsheetApp.flush();
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
