// Provider kustom `electron-updater` (spek desktop 4.2/5.5, rencana bagian 4): sumber pembaruan = server QC, bukan GitHub.
// Mengambil manifest rilis bertanda tangan, memverifikasinya dengan kunci publik tertanam (`evaluateRelease`), baru
// menyerahkan `UpdateInfo` (url server, sha512, ukuran) ke `electron-updater`, yang mengunduh, memeriksa sha512, dan memasang.
// "Tidak ada pembaruan" (404, JSON rusak, tanda tangan tak sah, versi tak lebih baru, jaringan putus) dikembalikan sebagai
// `UpdateInfo` berversi terpasang: `electron-updater` menyimpulkan tidak ada pembaruan tanpa galat. Alasan hanya di log.

import type { ReleaseArch } from '@shared/desktop-release';
import { Provider, type UpdateInfo } from 'electron-updater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import type { ResolvedUpdateFileInfo } from 'electron-updater/out/types';
import { evaluateRelease } from './release-verify';

export interface QcProviderConfig {
  /** Origin server QC (`settings.serverUrl`, tanpa garis miring akhir). */
  serverUrl: string;
  publicKeyPem: string;
  installedVersion: string;
  arch: ReleaseArch;
  fetchImpl: typeof fetch;
  log: (message: string) => void;
}

export interface QcProviderOptions extends QcProviderConfig {
  provider: 'custom';
  updateProvider: typeof QcUpdateProvider;
}

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

/** Membaca badan paling banyak `maxBytes` (berhenti di tengah aliran bila lebih); lebih besar = `null`. */
async function readCappedText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export class QcUpdateProvider extends Provider<UpdateInfo> {
  constructor(
    private readonly config: QcProviderOptions,
    _updater: unknown,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
  }

  async getLatestVersion(): Promise<UpdateInfo> {
    const { serverUrl, publicKeyPem, installedVersion, arch, fetchImpl, log } = this.config;
    const none = (reason: string): UpdateInfo => {
      log(`Pembaruan aplikasi: ${reason}`);
      return {
        version: installedVersion,
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
      };
    };
    let text: string | null;
    try {
      const response = await fetchImpl(`${serverUrl}/api/desktop/app-manifest?arch=${arch}`, {
        headers: { accept: 'application/json' },
        // Tanpa cookie sesi bawaan Electron: pembaruan berjalan tanpa login dan tak boleh membawa identitas apa pun.
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return none(`server menjawab ${response.status}`);
      text = await readCappedText(response, MAX_RESPONSE_BYTES);
    } catch {
      return none('server tidak terjangkau');
    }
    if (text === null) return none('jawaban server terlalu besar');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return none('jawaban server bukan JSON');
    }
    const record =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (
      typeof record.manifest !== 'object' ||
      record.manifest === null ||
      typeof record.signature !== 'string'
    ) {
      return none('bentuk jawaban server tidak dikenal');
    }
    const result = evaluateRelease({
      // Server mengirim objek; yang ditandatangani adalah teks kanonik `JSON.stringify` dari objek itu.
      manifestJson: JSON.stringify(record.manifest),
      signature: record.signature,
      publicKeyPem,
      installedVersion,
      arch,
    });
    if (result.kind === 'none') return none(result.reason);
    const { manifest, file } = result;
    const url = `${serverUrl}/api/desktop/app-file/${manifest.version}/${file.name}`;
    return {
      version: manifest.version,
      files: [{ url, sha512: file.sha512, size: file.size }],
      path: url,
      sha512: file.sha512,
      releaseDate: manifest.publishedAt,
      releaseNotes: manifest.changelog,
    };
  }

  resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return updateInfo.files.map((info) => ({ url: new URL(info.url), info }));
  }
}

/** Opsi untuk `autoUpdater.setFeedURL(...)`: `electron-updater` membangun `QcUpdateProvider(opsi, updater, runtime)`. */
export function createUpdateProviderOptions(config: QcProviderConfig): QcProviderOptions {
  return { ...config, provider: 'custom', updateProvider: QcUpdateProvider };
}
