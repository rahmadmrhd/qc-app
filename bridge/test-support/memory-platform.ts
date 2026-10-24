import { createHmac } from 'node:crypto';
import type {
  BridgeFileMeta,
  BridgePlatform,
  BridgeSheetLike,
  BridgeSpreadsheetLike,
} from '@bridge/platform';

export interface MemoryFile {
  name: string;
  mime: string;
  base64: string;
  parents: string[];
  trashed: boolean;
  shared: boolean;
}

export interface MemoryBridgePlatform extends BridgePlatform {
  properties: Map<string, string>;
  cache: Map<string, string>;
  folders: Map<string, { name: string; trashed: boolean }>;
  files: Map<string, MemoryFile>;
  external: Map<string, { name: string; mime: string; base64: string }>;
  /** Daftar efek pada Drive/Sheets (hanya operasi yang mengubah keadaan atau membaca isi). */
  effects: string[];
  sheets: Map<string, Map<string, string[][]>>;
  errors: string[];
  setNow(ms: number): void;
  addFolder(id: string, name?: string): void;
  addFile(id: string, file: Partial<MemoryFile> & { parents: string[] }): void;
}

export interface MemoryBridgeOptions {
  properties?: Record<string, string>;
  now?: number;
}

export const TEST_BRIDGE_SECRET = 'rahasia-jembatan-uji-'.repeat(2);

export function signForTest(
  action: string,
  ts: number,
  payload: unknown,
  secret = TEST_BRIDGE_SECRET,
): string {
  return createHmac('sha256', secret)
    .update(`${action}.${ts}.${JSON.stringify(payload === undefined ? {} : payload)}`)
    .digest('hex');
}

/** Platform jembatan dalam memori yang meniru semantik Drive/Sheets yang dipakai jembatan. */
export function createMemoryBridgePlatform(
  options: MemoryBridgeOptions = {},
): MemoryBridgePlatform {
  let now = options.now ?? Date.parse('2026-10-25T03:00:00.000Z');
  let counter = 0;
  const properties = new Map(
    Object.entries({ BRIDGE_SECRET: TEST_BRIDGE_SECRET, ...options.properties }),
  );
  const cache = new Map<string, string>();
  const folders = new Map<string, { name: string; trashed: boolean }>();
  const files = new Map<string, MemoryFile>();
  const external = new Map<string, { name: string; mime: string; base64: string }>();
  const effects: string[] = [];
  const sheets = new Map<string, Map<string, string[][]>>();
  const errors: string[] = [];
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  function size(base64: string): number {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
  }

  function sheetOf(table: Map<string, string[][]>, name: string): BridgeSheetLike {
    const rows = () => table.get(name) as string[][];
    return {
      getLastRow: () => rows().length,
      getRange: (row, column, numRows, numColumns) => ({
        setNumberFormat: () => undefined,
        setValues: (values) => {
          effects.push(`sheets.write:${name}`);
          const target = rows();
          for (let r = 0; r < numRows; r++) {
            const line = target[row - 1 + r] ?? [];
            for (let c = 0; c < numColumns; c++) line[column - 1 + c] = values[r]?.[c] ?? '';
            target[row - 1 + r] = line;
          }
        },
      }),
      clearContents: () => {
        effects.push(`sheets.clear:${name}`);
        table.set(name, []);
      },
      dataValues: () => rows().map((line) => [...line]),
    };
  }

  const platform: MemoryBridgePlatform = {
    properties,
    cache,
    folders,
    files,
    external,
    effects,
    sheets,
    errors,
    setNow: (ms) => {
      now = ms;
    },
    addFolder: (id, name = id) => {
      folders.set(id, { name, trashed: false });
    },
    addFile: (id, file) => {
      files.set(id, {
        name: id,
        mime: 'application/octet-stream',
        base64: '',
        trashed: false,
        shared: false,
        ...file,
      });
    },
    getProperty: (key) => properties.get(key) ?? null,
    cacheGet: (key) => cache.get(key) ?? null,
    cachePut: (key, value) => {
      cache.set(key, value);
    },
    hmacSha256Hex: (data, secret) => createHmac('sha256', secret).update(data).digest('hex'),
    now: () => now,
    logError: (message) => {
      errors.push(message);
    },
    withLock: (fn) => fn(),
    spreadsheet: (id): BridgeSpreadsheetLike => {
      let table = sheets.get(id);
      if (!table) {
        table = new Map();
        sheets.set(id, table);
      }
      const current = table;
      return {
        sheetNames: () => [...current.keys()],
        getSheetByName: (name) => (current.has(name) ? sheetOf(current, name) : null),
        insertSheet: (name) => {
          effects.push(`sheets.insert:${name}`);
          current.set(name, []);
          return sheetOf(current, name);
        },
      };
    },
    driveCreateFolder: (name) => {
      const id = nextId('folder');
      effects.push(`drive.createFolder:${id}`);
      folders.set(id, { name, trashed: false });
      return id;
    },
    driveCreateFile: (folderId, name, mime, base64) => {
      const id = nextId('file');
      effects.push(`drive.createFile:${id}`);
      files.set(id, { name, mime, base64, parents: [folderId], trashed: false, shared: false });
      return id;
    },
    driveFileMeta: (fileId): BridgeFileMeta | null => {
      const file = files.get(fileId);
      if (!file) return null;
      return {
        parentIds: [...file.parents],
        trashed: file.trashed,
        mime: file.mime,
        size: size(file.base64),
        name: file.name,
      };
    },
    driveReadBase64: (fileId) => {
      const file = files.get(fileId);
      return file ? { mime: file.mime, base64: file.base64 } : null;
    },
    driveFolderMeta: (folderId) => {
      const folder = folders.get(folderId);
      return folder ? { trashed: folder.trashed } : null;
    },
    driveTrashFile: (fileId) => {
      effects.push(`drive.trash:${fileId}`);
      const file = files.get(fileId);
      if (file) file.trashed = true;
    },
    driveExternalFileInfo: (fileId) => {
      const file = external.get(fileId);
      return file ? { name: file.name, mime: file.mime, size: size(file.base64) } : null;
    },
    driveReadExternalFile: (fileId) => {
      const file = external.get(fileId);
      return file ? { mime: file.mime, base64: file.base64 } : null;
    },
    driveCopyFile: (fileId, folderId, name) => {
      const source = external.get(fileId) ?? files.get(fileId);
      if (!source) throw new Error('Berkas sumber tidak ada');
      const id = nextId('file');
      effects.push(`drive.copy:${id}`);
      files.set(id, {
        name,
        mime: source.mime,
        base64: source.base64,
        parents: [folderId],
        trashed: false,
        shared: false,
      });
      return id;
    },
    driveRenameFile: (fileId, name) => {
      effects.push(`drive.rename:${fileId}`);
      const file = files.get(fileId);
      if (!file) throw new Error('Berkas tidak ada');
      file.name = name;
    },
    driveShareAnyoneWithLink: (fileId) => {
      effects.push(`drive.share:${fileId}`);
      const file = files.get(fileId);
      if (!file) throw new Error('Berkas tidak ada');
      file.shared = true;
    },
    driveRevokeSharing: (fileId) => {
      effects.push(`drive.revoke:${fileId}`);
      const file = files.get(fileId);
      if (file) file.shared = false;
    },
    driveReplaceFileContent: (fileId, mime, base64) => {
      effects.push(`drive.replace:${fileId}`);
      const file = files.get(fileId);
      if (!file) throw new Error('Berkas tidak ada');
      file.mime = mime;
      file.base64 = base64;
    },
  };
  return platform;
}
