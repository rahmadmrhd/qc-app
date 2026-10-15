import type {
  HttpResponseLike,
  Platform,
  RangeLike,
  SheetLike,
  SpreadsheetLike,
} from '@gas/core/platform';
import { base64ByteLength } from '@shared/files';

const NUMBER_LIKE = /^[+-]?d+(.d+)?([eE][+-]?d+)?$/;
const DATE_LIKE = /^d{4}-d{2}-d{2}(T[d:.]+Z?)?$/;

/**
 * Meniru Google Sheets. Sel berformat teks ('@') menyimpan string apa adanya. Selain itu: apostrof depan =
 * teks literal; string "=" dievaluasi jadi formula; teks mirip angka/tanggal diubah menjadi angka/Date.
 */
function storeCell(value: unknown, asText: boolean): unknown {
  if (typeof value !== 'string' || asText) return value;
  if (value.startsWith("'")) return value.slice(1);
  if (value.startsWith('=')) return '#FORMULA';
  if (NUMBER_LIKE.test(value)) return Number(value);
  if (DATE_LIKE.test(value) && !Number.isNaN(Date.parse(value))) return new Date(value);
  return value;
}

export class MemorySheet implements SheetLike {
  rows: unknown[][];
  /** Sel ("baris,kolom", 1-based) yang berformat teks. */
  private readonly textCells = new Set<string>();

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
      setNumberFormat: (format: string) => {
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numColumns; c++) {
            const key = `${row + r},${column + c}`;
            if (format === '@') this.textCells.add(key);
            else this.textCells.delete(key);
          }
        }
        return undefined;
      },
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
            target[column - 1 + c] = storeCell(
              value,
              this.textCells.has(`${row + r},${column + c}`),
            );
          });
          this.rows[index] = target;
        });
      },
    };
  }

  appendRow(values: unknown[]): void {
    this.rows.push(values.map((value) => storeCell(value, false)));
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
  /** Folder yang ditandai berada di tempat sampah (untuk menguji `driveFolderExists`). */
  readonly trashedFolders: Set<string>;
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
  const trashedFolders = new Set<string>();
  let locked = false;
  let driveSequence = 0;
  const drive = new Map<string, MemoryDriveFile>();
  return {
    db,
    properties,
    cache,
    errors,
    httpCalls,
    folders,
    trashedFolders,
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
      // LockService asli tidak reentrant: kunci bersarang di produksi menunggu dirinya sendiri hingga habis waktu.
      if (locked) throw new Error('withLock bersarang: LockService tidak reentrant');
      locked = true;
      try {
        return fn();
      } finally {
        locked = false;
      }
    },
    flush: () => undefined,
    spreadsheet: () => db,
    driveCreateFolder: (name) => {
      const id = `folder-${++driveSequence}`;
      folders.set(id, name);
      return id;
    },
    driveCreateFile: (folderId, name, mime, base64) => {
      if (!folders.has(folderId)) throw new Error(`Folder Drive ${folderId} tidak ada`);
      const id = `file-${++driveSequence}`;
      drive.set(id, { folderId, name, mime, base64 });
      return id;
    },
    driveReadFile: (fileId, folderId) => {
      const file = drive.get(fileId);
      return file && file.folderId === folderId ? { mime: file.mime, base64: file.base64 } : null;
    },
    driveFileInfo: (fileId, folderId) => {
      const file = drive.get(fileId);
      if (!file || file.folderId !== folderId || trashedFolders.has(file.folderId)) return null;
      return { mime: file.mime, size: base64ByteLength(file.base64) };
    },
    driveFolderExists: (folderId) => folders.has(folderId) && !trashedFolders.has(folderId),
    driveTrashFile: (fileId) => {
      drive.delete(fileId);
    },
    logError: (message) => {
      errors.push(message);
    },
  };
}
