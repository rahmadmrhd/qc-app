import type {
  BridgeClient,
  BridgeExternalFileInfo,
  SheetsDump,
  SheetsExportChunk,
} from '@server/core/bridge-client';

export interface FakeFile {
  folderId: string;
  name: string;
  mime: string;
  base64: string;
  shared: boolean;
  trashed: boolean;
}

export interface FakeBridgeState {
  folders: Set<string>;
  files: Map<string, FakeFile>;
  external: Map<string, { name: string; mime: string; base64: string }>;
  dump: SheetsDump;
  exports: SheetsExportChunk[];
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

/** Jembatan Drive/Sheets dalam memori, meniru semantik `Platform` GAS (induk folder, tempat sampah). */
export function createFakeBridge(): FakeBridge {
  const state: FakeBridgeState = {
    folders: new Set(),
    files: new Map(),
    external: new Map(),
    dump: {},
    exports: [],
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
    async sheetsExport(chunk) {
      enter('sheetsExport', [chunk]);
      state.exports.push(chunk);
    },
    async sheetsDump() {
      enter('sheetsDump', []);
      return state.dump;
    },
  };
  return bridge;
}
