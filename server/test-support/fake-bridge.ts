import { createHash } from 'node:crypto';
import type {
  BridgeClient,
  BridgeExternalFileInfo,
  DriveFolderEntry,
  DriveRange,
  SheetsExportChunk,
} from '@server/core/bridge-client';
import { base64ToBytes, bytesToBase64 } from '@server/core/bytes';

export interface FakeFile {
  folderId: string;
  name: string;
  mime: string;
  base64: string;
  shared: boolean;
  trashed: boolean;
  appProperties?: Record<string, string>;
}

export interface FakeBridgeState {
  folders: Set<string>;
  files: Map<string, FakeFile>;
  external: Map<string, { name: string; mime: string; base64: string }>;
  exports: SheetsExportChunk[];
  /** Kuota yang dilaporkan `storageQuota()`. */
  quota: { limit: number | null; usage: number };
}

export interface FakeBridge extends BridgeClient {
  state: FakeBridgeState;
  calls: { action: string; args: unknown[] }[];
  seedExternal(id: string, file: { name: string; mime: string; base64: string }): void;
  /** Aksi berikutnya (satu kali) melempar `error`; untuk menguji kegagalan di tengah alur. */
  failNext(action: keyof BridgeClient, error: Error): void;
}

/** Ukuran byte dari string base64 (tanpa decode). */
function base64Size(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Jembatan Drive/Sheets dalam memori (induk folder, tempat sampah). */
export function createFakeBridge(): FakeBridge {
  const state: FakeBridgeState = {
    folders: new Set(),
    files: new Map(),
    external: new Map(),
    exports: [],
    quota: { limit: null, usage: 0 },
  };
  const failures = new Map<string, Error>();
  const calls: FakeBridge['calls'] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  function enter(action: string, args: unknown[]): void {
    calls.push({ action, args });
    const failure = failures.get(action);
    if (failure) {
      failures.delete(action);
      throw failure;
    }
  }

  function visible(fileId: string, folderId: string): FakeFile | null {
    const file = state.files.get(fileId);
    if (!file || file.trashed || file.folderId !== folderId) return null;
    return file;
  }

  function require(fileId: string): FakeFile {
    const file = state.files.get(fileId);
    if (!file) throw new Error(`Berkas ${fileId} tidak ada`);
    return file;
  }

  const bridge: FakeBridge = {
    state,
    calls,
    seedExternal(id, file) {
      state.external.set(id, file);
    },
    failNext(action, error) {
      failures.set(action, error);
    },
    async createFolder(name) {
      enter('createFolder', [name]);
      const id = nextId('folder');
      state.folders.add(id);
      return id;
    },
    async createFile(folderId, name, mime, base64) {
      enter('createFile', [folderId, name, mime, base64]);
      const id = nextId('file');
      state.files.set(id, { folderId, name, mime, base64, shared: false, trashed: false });
      return id;
    },
    async readFile(fileId, folderId) {
      enter('readFile', [fileId, folderId]);
      const file = visible(fileId, folderId);
      return file ? { mime: file.mime, base64: file.base64 } : null;
    },
    async fileInfo(fileId, folderId) {
      enter('fileInfo', [fileId, folderId]);
      const file = visible(fileId, folderId);
      return file ? { mime: file.mime, size: base64Size(file.base64) } : null;
    },
    async folderExists(folderId) {
      enter('folderExists', [folderId]);
      return state.folders.has(folderId);
    },
    async trashFile(fileId) {
      enter('trashFile', [fileId]);
      const file = state.files.get(fileId);
      if (file) file.trashed = true;
    },
    async externalFileInfo(fileId, resourceKey) {
      enter('externalFileInfo', [fileId, resourceKey]);
      const file = state.external.get(fileId);
      if (!file) return null;
      const info: BridgeExternalFileInfo = {
        name: file.name,
        mime: file.mime,
        size: base64Size(file.base64),
      };
      return info;
    },
    async readExternalFile(fileId, resourceKey) {
      enter('readExternalFile', [fileId, resourceKey]);
      const file = state.external.get(fileId);
      return file ? { mime: file.mime, base64: file.base64 } : null;
    },
    async copyFile(fileId, folderId, name, resourceKey) {
      enter('copyFile', [fileId, folderId, name, resourceKey]);
      const source = state.external.get(fileId) ?? state.files.get(fileId);
      if (!source) throw new Error(`Berkas ${fileId} tidak ada`);
      const id = nextId('file');
      state.files.set(id, {
        folderId,
        name,
        mime: source.mime,
        base64: source.base64,
        shared: false,
        trashed: false,
      });
      return id;
    },
    async renameFile(fileId, name) {
      enter('renameFile', [fileId, name]);
      require(fileId).name = name;
    },
    async shareAnyoneWithLink(fileId) {
      enter('shareAnyoneWithLink', [fileId]);
      require(fileId).shared = true;
    },
    async revokeSharing(fileId) {
      enter('revokeSharing', [fileId]);
      const file = state.files.get(fileId);
      if (file) file.shared = false;
    },
    async replaceFileContent(fileId, mime, base64) {
      enter('replaceFileContent', [fileId, mime, base64]);
      const file = require(fileId);
      file.mime = mime;
      file.base64 = base64;
    },
    async uploadFile(folderId, name, mime, source, options) {
      enter('uploadFile', [folderId, name, mime, options]);
      const bytes =
        source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
      const id = nextId('file');
      state.files.set(id, {
        folderId,
        name,
        mime,
        base64: bytesToBase64(bytes),
        shared: false,
        trashed: false,
        ...(options?.appProperties ? { appProperties: options.appProperties } : {}),
      });
      return { id, size: bytes.length, md5Checksum: createHash('md5').update(bytes).digest('hex') };
    },
    async downloadFile(fileId, folderId, range?: DriveRange) {
      enter('downloadFile', [fileId, folderId, range]);
      const file = visible(fileId, folderId);
      if (!file) return null;
      const bytes = base64ToBytes(file.base64);
      if (range === undefined) {
        return {
          mime: file.mime,
          size: bytes.length,
          body: new Response(bytes).body as ReadableStream<Uint8Array>,
        };
      }
      if (range.start < 0 || range.end < range.start || range.start >= bytes.length) {
        throw new Error('Rentang byte tidak valid');
      }
      const served = { start: range.start, end: Math.min(range.end, bytes.length - 1) };
      return {
        mime: file.mime,
        size: bytes.length,
        range: served,
        body: new Response(bytes.slice(served.start, served.end + 1))
          .body as ReadableStream<Uint8Array>,
      };
    },
    async listFolder(folderId, options) {
      enter('listFolder', [folderId, options]);
      const all = [...state.files.entries()]
        .filter(
          ([, file]) =>
            file.folderId === folderId &&
            !file.trashed &&
            (options?.name === undefined || file.name === options.name),
        )
        .map(([id, file]): DriveFolderEntry => {
          const bytes = base64ToBytes(file.base64);
          return {
            id,
            name: file.name,
            mime: file.mime,
            size: bytes.length,
            md5Checksum: createHash('md5').update(bytes).digest('hex'),
            appProperties: file.appProperties ?? {},
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const size = options?.pageSize ?? 100;
      const offset = Number(options?.pageToken ?? '0');
      const next = offset + size;
      return {
        files: all.slice(offset, next),
        ...(next < all.length ? { nextPageToken: String(next) } : {}),
      };
    },
    async deleteFile(fileId) {
      enter('deleteFile', [fileId]);
      state.files.delete(fileId);
    },
    async storageQuota() {
      enter('storageQuota', []);
      return { ...state.quota };
    },
    async sheetsExport(chunk) {
      enter('sheetsExport', [chunk]);
      state.exports.push(chunk);
    },
  };
  return bridge;
}
