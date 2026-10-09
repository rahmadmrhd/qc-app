import type {
  HttpResponseLike,
  Platform,
  RangeLike,
  SheetLike,
  SpreadsheetLike,
} from '@gas/core/platform';

/** Meniru Google Sheets: apostrof depan = teks literal; string "=" tanpa apostrof dievaluasi jadi formula. */
function storeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.startsWith("'")) return value.slice(1);
  if (value.startsWith('=')) return '#FORMULA';
  return value;
}

export class MemorySheet implements SheetLike {
  rows: unknown[][];

  constructor(rows: unknown[][] = []) {
    this.rows = rows;
  }

  getLastRow(): number {
    return this.rows.length;
  }

  getLastColumn(): number {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getRange(row: number, column: number, numRows: number, numColumns: number): RangeLike {
    return {
      getValues: () => {
        const out: unknown[][] = [];
        for (let r = 0; r < numRows; r++) {
          const source = this.rows[row - 1 + r] ?? [];
          const line: unknown[] = [];
          for (let c = 0; c < numColumns; c++) line.push(source[column - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      setValues: (values: unknown[][]) => {
        values.forEach((line, r) => {
          const index = row - 1 + r;
          while (this.rows.length <= index) this.rows.push([]);
          const target = this.rows[index] ?? [];
          line.forEach((value, c) => {
            target[column - 1 + c] = storeCell(value);
          });
          this.rows[index] = target;
        });
      },
    };
  }

  appendRow(values: unknown[]): void {
    this.rows.push(values.map(storeCell));
  }

  deleteRow(row: number): void {
    this.rows.splice(row - 1, 1);
  }
}

export class MemorySpreadsheet implements SpreadsheetLike {
  readonly sheets = new Map<string, MemorySheet>();

  getSheetByName(name: string): MemorySheet | null {
    return this.sheets.get(name) ?? null;
  }

  insertSheet(name: string): MemorySheet {
    const sheet = new MemorySheet();
    this.sheets.set(name, sheet);
    return sheet;
  }

  /** Helper test: ambil sheet yang wajib sudah ada. */
  sheet(name: string): MemorySheet {
    const found = this.sheets.get(name);
    if (!found) throw new Error(`Sheet ${name} belum ada`);
    return found;
  }
}

export interface MemoryDriveFile {
  folderId: string;
  name: string;
  mime: string;
  base64: string;
}

export interface MemoryPlatformOptions {
  properties?: Record<string, string>;
  now?: () => number;
  /** URL web app yang dilaporkan `scriptUrl()`; default kosong. */
  scriptUrl?: string;
  http?: (url: string, form: Record<string, string>) => HttpResponseLike;
}

export interface MemoryPlatform extends Platform {
  readonly db: MemorySpreadsheet;
  readonly properties: Map<string, string>;
  readonly cache: Map<string, string>;
  readonly errors: string[];
  readonly folders: Map<string, string>;
  readonly drive: Map<string, MemoryDriveFile>;
  readonly httpCalls: Array<{ url: string; form: Record<string, string> }>;
}

/** Hash non-kriptografis — HANYA untuk test & mode dev. */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function createMemoryPlatform(options: MemoryPlatformOptions = {}): MemoryPlatform {
  const properties = new Map(Object.entries(options.properties ?? {}));
  const cache = new Map<string, string>();
  const db = new MemorySpreadsheet();
  const errors: string[] = [];
  const httpCalls: Array<{ url: string; form: Record<string, string> }> = [];
  const folders = new Map<string, string>();
  const drive = new Map<string, MemoryDriveFile>();
  return {
    db,
    properties,
    cache,
    errors,
    httpCalls,
    folders,
    drive,
    getProperty: (key) => properties.get(key) ?? null,
    setProperty: (key, value) => {
      properties.set(key, value);
    },
    scriptUrl: () => options.scriptUrl ?? '',
    cacheGet: (key) => cache.get(key) ?? null,
    cachePut: (key, value) => {
      cache.set(key, value);
    },
    cacheRemove: (key) => {
      cache.delete(key);
    },
    hmacSha256Base64Url: (data, secret) =>
      fnv1a(`${secret}|${data}`, 0x811c9dc5) + fnv1a(`${data}|${secret}`, 0x01000193),
    base64UrlEncode: toBase64Url,
    base64UrlDecode: fromBase64Url,
    uuid: randomId,
    now: options.now ?? (() => Date.now()),
    httpPostForm: (url, form) => {
      httpCalls.push({ url, form });
      if (!options.http) throw new Error('HTTP tidak dikonfigurasi di memory platform');
      return options.http(url, form);
    },
    withLock<T>(fn: () => T): T {
      return fn();
    },
    flush: () => undefined,
    spreadsheet: () => db,
    driveCreateFolder: (name) => {
      const id = `folder-${folders.size + 1}`;
      folders.set(id, name);
      return id;
    },
    driveCreateFile: (folderId, name, mime, base64) => {
      if (!folders.has(folderId)) throw new Error(`Folder Drive ${folderId} tidak ada`);
      const id = `file-${drive.size + 1}`;
      drive.set(id, { folderId, name, mime, base64 });
      return id;
    },
    driveReadFile: (fileId) => {
      const file = drive.get(fileId);
      return file ? { mime: file.mime, base64: file.base64 } : null;
    },
    logError: (message) => {
      errors.push(message);
    },
  };
}
