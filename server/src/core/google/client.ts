import { readFile } from 'node:fs/promises';
import type { BridgeClient } from '@server/core/bridge-client';
import { createTokenProvider, GOOGLE_SCOPES } from './auth';
import { createDriveApi } from './drive';
import { createGoogleHttp } from './request';
import type { GoogleDeps, GoogleSettings } from './settings';
import { createSheetsApi } from './sheets';

export type GoogleClient = BridgeClient;

/**
 * Klien Google langsung (service account; menggantikan jembatan Apps Script, T30a): Drive v3 dan Sheets v4 lewat
 * `fetch`, di belakang antarmuka `BridgeClient` yang sama. Murni malas: berkas kunci baru dibaca dan token baru
 * ditukar pada panggilan pertama, jadi membuat klien tidak pernah gagal atau menyentuh jaringan.
 */
export function createGoogleClient(settings: GoogleSettings, deps: GoogleDeps = {}): GoogleClient {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const tokens = createTokenProvider({
    keyFile: settings.GOOGLE_SA_KEY_FILE,
    scopes: GOOGLE_SCOPES,
    fetch: fetchImpl,
    readKeyFile: deps.readKeyFile ?? ((path) => readFile(path, 'utf8')),
    now: deps.now ?? Date.now,
    sleep,
  });
  const http = createGoogleHttp({ tokens, fetch: fetchImpl, sleep });
  return { ...createDriveApi(http, settings), ...createSheetsApi(http, settings, sleep) };
}
