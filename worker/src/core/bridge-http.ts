import type {
  BridgeClient,
  BridgeExternalFileInfo,
  BridgeFile,
  BridgeFileInfo,
  SheetsDump,
  SheetsExportChunk,
} from './bridge-client';
import { type Env, nowOf } from './env';
import { appError } from './errors';

/**
 * Klien HTTP jembatan Apps Script (Task 3.2). Protokol: docs/setup-bridge.md bagian 4.
 * - Badan `{action, ts, sig, payload}`; `sig` = HMAC-SHA256 hex atas `action.ts.payloadJson` (WebCrypto).
 * - Payload besar disusun dengan PENYAMBUNGAN STRING; base64 tidak pernah di-parse, di-decode, atau di-encode,
 *   dan balasan besar (`readFile`) diiris tanpa `JSON.parse`.
 * - Tiap percobaan (termasuk ulang) ditandatangani baru dengan `ts` baru yang menaik (tanda tangan sekali pakai).
 * - `fetch` mengikuti 302 Apps Script otomatis (`redirect: 'follow'`; spike Task 0.2).
 */

export interface BridgeClientOptions {
  /** Batas waktu satu percobaan (ms). Menunggu jaringan tidak dihitung CPU. */
  timeoutMs?: number;
  /** Percobaan ulang untuk galat jaringan pada aksi idempoten. */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_RETRIES = 1;
/** Balasan lebih panjang dari ini tidak di-parse utuh bila berbentuk `{mime, base64}`. */
const LARGE_RESPONSE_CHARS = 4096;
const FILE_PREFIX = '{"ok":true,"data":{"mime":';
const BASE64_MARK = ',"base64":"';
const FILE_SUFFIX = '"}}';

const CLOCK_REWIND_MS = 60_000;
/** Batas base64 per panggilan: badan jembatan maks. 1.048.576 karakter termasuk amplop (docs/setup-bridge.md). */
export const BRIDGE_BASE64_MAX_CHARS = 1_000_000;

/** `ts` terakhir yang dipakai di isolate ini: menjamin tanda tangan unik walau jam sama. */
let lastTs = 0;

const encoder = new TextEncoder();

async function signHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  let hex = '';
  for (const byte of signature) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

interface Reply {
  ok: boolean;
  error?: string;
  message?: string;
  data?: unknown;
  /** Hanya untuk balasan berkas besar yang diiris tanpa parse. */
  file?: BridgeFile;
}

function unavailable(message: string): never {
  throw appError('UNAVAILABLE', message);
}

/**
 * Mengiris balasan `{"ok":true,"data":{"mime":"…","base64":"…"}}` tanpa `JSON.parse` atas base64.
 * `null` bila bentuknya lain (diparse biasa; balasan kecil/galat).
 */
function sliceFileReply(text: string): BridgeFile | null {
  if (!text.startsWith(FILE_PREFIX) || !text.endsWith(FILE_SUFFIX)) return null;
  const mark = text.indexOf(BASE64_MARK, FILE_PREFIX.length);
  if (mark < 0) return null;
  const mime = JSON.parse(text.slice(FILE_PREFIX.length, mark)) as unknown;
  if (typeof mime !== 'string') return null;
  return { mime, base64: text.slice(mark + BASE64_MARK.length, text.length - FILE_SUFFIX.length) };
}

function parseReply(text: string, allowFileSlice: boolean): Reply {
  if (allowFileSlice && text.length > LARGE_RESPONSE_CHARS) {
    const file = sliceFileReply(text);
    if (file) return { ok: true, file };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unavailable('Jembatan Google membalas dengan format yang tidak dikenal');
  }
  if (typeof value !== 'object' || value === null || typeof (value as Reply).ok !== 'boolean') {
    return unavailable('Jembatan Google membalas dengan format yang tidak dikenal');
  }
  return value as Reply;
}

function bridgeFailure(reply: Reply, action: string): never {
  switch (reply.error) {
    case 'UNAUTHENTICATED':
      // Rahasia/jam salah, aksi atau folder tak terdaftar, atau berkas bukan anak folder: bukan "tidak ada".
      console.error(
        `Jembatan menolak ${action} (UNAUTHENTICATED): periksa BRIDGE_SECRET/ALLOWED_FOLDER_IDS`,
      );
      return unavailable('Akses ke Google Drive ditolak oleh jembatan. Hubungi admin.');
    case 'NOT_FOUND':
      throw appError('NOT_FOUND', reply.message ?? 'Berkas tidak ditemukan');
    case 'VALIDATION':
      throw appError('VALIDATION', reply.message ?? 'Permintaan ke Google Drive tidak valid');
    default:
      console.error(`Jembatan ${action} gagal: ${reply.error ?? '?'} ${reply.message ?? ''}`);
      return unavailable('Layanan Google Drive mengalami gangguan. Coba lagi sebentar lagi.');
  }
}

/**
 * Membuat klien jembatan nyata. `fetchImpl` disuntik di tes; `payload` aksi disusun sebagai teks JSON.
 */
export function createBridgeClient(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  options: BridgeClientOptions = {},
): BridgeClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  async function attempt(action: string, payloadJson: string): Promise<string> {
    const now = nowOf(env);
    // Menaik ketat agar dua tanda tangan tidak pernah sama; bila jam mundur jauh (tes/koreksi jam), mulai ulang.
    const ts = lastTs >= now && lastTs - now < CLOCK_REWIND_MS ? lastTs + 1 : now;
    lastTs = ts;
    const sig = await signHex(env.BRIDGE_SECRET, `${action}.${ts}.${payloadJson}`);
    const body = `{"action":"${action}","ts":${ts},"sig":"${sig}","payload":${payloadJson}}`;
    let response: Response;
    try {
      response = await fetchImpl(env.BRIDGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      throw Object.assign(new Error(timedOut ? 'timeout' : 'network'), {
        transient: true,
        timedOut,
      });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), {
        transient: response.status >= 500,
      });
    }
    return await response.text();
  }

  async function call(
    action: string,
    payloadJson: string,
    opts: { idempotent: boolean; fileReply?: boolean } = { idempotent: false },
  ): Promise<Reply> {
    const maxAttempts = opts.idempotent ? 1 + retries : 1;
    let text: string | undefined;
    for (let n = 1; n <= maxAttempts; n++) {
      try {
        text = await attempt(action, payloadJson);
        break;
      } catch (error) {
        const info = error as { transient?: boolean; timedOut?: boolean; message?: string };
        if (!info.transient) throw error;
        if (n < maxAttempts) continue;
        console.error(`Jembatan ${action} gagal (${info.message ?? '?'}) setelah ${n} percobaan`);
        return unavailable(
          info.timedOut
            ? 'Layanan Google Drive tidak menjawab (batas waktu terlampaui). Coba lagi sebentar lagi.'
            : 'Layanan Google Drive sedang tidak dapat dihubungi. Coba lagi sebentar lagi.',
        );
      }
    }
    const reply = parseReply(text as string, opts.fileReply === true);
    if (!reply.ok) bridgeFailure(reply, action);
    return reply;
  }

  const json = (value: unknown) => JSON.stringify(value);
  /** Payload dengan base64 besar: metadata di-stringify, base64 disambung sebagai string. */
  function withBase64(meta: Record<string, unknown>, base64: string): string {
    if (base64.length > BRIDGE_BASE64_MAX_CHARS) {
      throw appError(
        'VALIDATION',
        'Berkas terlalu besar untuk diteruskan ke Google Drive (maksimal sekitar 750 KB)',
      );
    }
    if (base64.includes('"') || base64.includes('\\')) {
      throw appError('VALIDATION', 'Isi berkas bukan base64 yang valid');
    }
    return `${json(meta).slice(0, -1)},"base64":"${base64}"}`;
  }
  const id = (reply: Reply): string => (reply.data as { id: string }).id;

  return {
    async createFolder(name) {
      return id(await call('drive.createFolder', json({ name })));
    },
    async createFile(folderId, name, mime, base64) {
      const payload = withBase64({ folderId, name, mime }, base64);
      return id(await call('drive.createFile', payload));
    },
    async readFile(fileId, folderId) {
      const reply = await call('drive.readFile', json({ fileId, folderId }), {
        idempotent: true,
        fileReply: true,
      });
      return reply.file ?? (reply.data as BridgeFile | null);
    },
    async fileInfo(fileId, folderId) {
      const reply = await call('drive.fileInfo', json({ fileId, folderId }), { idempotent: true });
      return reply.data as BridgeFileInfo | null;
    },
    async folderExists(folderId) {
      const reply = await call('drive.folderExists', json({ folderId }), { idempotent: true });
      return (reply.data as { exists: boolean }).exists;
    },
    async trashFile(fileId) {
      await call('drive.trashFile', json({ fileId }), { idempotent: true });
    },
    async externalFileInfo(fileId, resourceKey) {
      const reply = await call('drive.externalFileInfo', json({ fileId, resourceKey }), {
        idempotent: true,
      });
      return reply.data as BridgeExternalFileInfo | null;
    },
    async readExternalFile(fileId, resourceKey) {
      const reply = await call('drive.readExternalFile', json({ fileId, resourceKey }), {
        idempotent: true,
        fileReply: true,
      });
      return reply.file ?? (reply.data as BridgeFile | null);
    },
    async copyFile(fileId, folderId, name, resourceKey) {
      return id(await call('drive.copyFile', json({ fileId, folderId, name, resourceKey })));
    },
    async renameFile(fileId, name) {
      await call('drive.renameFile', json({ fileId, name }), { idempotent: true });
    },
    async shareAnyoneWithLink(fileId) {
      await call('drive.shareAnyoneWithLink', json({ fileId }), { idempotent: true });
    },
    async revokeSharing(fileId) {
      await call('drive.revokeSharing', json({ fileId }), { idempotent: true });
    },
    async replaceFileContent(fileId, mime, base64) {
      await call('drive.replaceFileContent', withBase64({ fileId, mime }, base64), {
        idempotent: true,
      });
    },
    async sheetsExport(chunk: SheetsExportChunk) {
      // `replace` menimpa seluruh sheet sehingga aman diulang; `append` tidak (dapat menggandakan baris).
      await call('sheets.export', json(chunk), { idempotent: chunk.mode === 'replace' });
    },
    async sheetsDump(sheets?: string[]): Promise<SheetsDump> {
      const reply = await call('sheets.dump', json(sheets ? { sheets } : {}), { idempotent: true });
      return (reply.data as { tables: SheetsDump }).tables;
    },
  };
}
