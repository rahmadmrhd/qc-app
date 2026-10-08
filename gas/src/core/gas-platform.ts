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
        lock.releaseLock();
      }
    },
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

export function renderErrorPage_(message: string): GoogleAppsScript.HTML.HtmlOutput {
  const escaped = message.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch,
  );
  return HtmlService.createHtmlOutput(
    `<main style="font-family:sans-serif;padding:2rem"><h1>QC App</h1><p>${escaped}</p></main>`,
  ).setTitle('QC App');
}

/** `setup` hanya boleh dijalankan pemilik script dari editor, bukan lewat google.script.run. */
export function assertScriptOwner_(): void {
  const active = Session.getActiveUser().getEmail();
  const owner = Session.getEffectiveUser().getEmail();
  if (!active || active !== owner) {
    throw new Error('setup hanya boleh dijalankan oleh pemilik script dari editor Apps Script.');
  }
}
