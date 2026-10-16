import type { RowData, StoredRow } from './db';
import { platform_ } from './platform';

/**
 * Cache LINTAS request (CacheService) untuk tabel kecil yang jarang berubah dan sering dibaca (lokasi, role, dll.).
 * Tiap tabel punya "versi" (`tblv:<sheet>`); isi disimpan di `tbl:<sheet>:<versi>`. Menulis tabel mengganti versi
 * sehingga isi lama otomatis tidak terpakai. Versi diganti DUA kali: saat tulis dan lagi sesudah `flush` di akhir lock
 * (pembaca yang menyusup di antaranya bisa menyimpan isi lama di bawah versi baru; penggantian kedua membuangnya).
 * TTL pendek membatasi basi akibat suntingan manual di Sheets.
 */
export const TABLE_CACHE_TTL_SECONDS = 300;
const VERSION_TTL_SECONDS = 21600;
/** Batas CacheService 100 KB per nilai (byte); sisakan ruang. */
const MAX_CACHE_BYTES = 90_000;

interface PackedTable {
  h: string[];
  /** Tiap baris: [rowNumber, ...nilai sesuai urutan header]. */
  r: Array<[number, ...string[]]>;
}

function versionKey_(sheetName: string): string {
  return `tblv:${sheetName}`;
}

function currentVersion_(sheetName: string): string {
  const platform = platform_();
  const existing = platform.cacheGet(versionKey_(sheetName));
  if (existing) return existing;
  const next = platform.uuid();
  platform.cachePut(versionKey_(sheetName), next, VERSION_TTL_SECONDS);
  return next;
}

/** Panjang UTF-8 (byte) tanpa TextEncoder (tidak ada di runtime Apps Script). */
export function utf8Length_(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function readSharedTable_(
  sheetName: string,
): { header: string[]; rows: StoredRow[] } | null {
  const platform = platform_();
  const version = platform.cacheGet(versionKey_(sheetName));
  if (!version) return null;
  const raw = platform.cacheGet(`tbl:${sheetName}:${version}`);
  if (raw === null) return null;
  try {
    const packed = JSON.parse(raw) as PackedTable;
    const rows: StoredRow[] = packed.r.map((entry) => {
      const data: RowData = {};
      packed.h.forEach((name, column) => {
        if (name) data[name] = entry[column + 1] as string;
      });
      return { rowNumber: entry[0], data };
    });
    return { header: packed.h, rows };
  } catch {
    return null;
  }
}

export function writeSharedTable_(
  sheetName: string,
  table: { header: string[]; rows: StoredRow[] },
): void {
  const packed: PackedTable = {
    h: table.header,
    r: table.rows.map((row) => [
      row.rowNumber,
      ...table.header.map((name) => (name ? (row.data[name] ?? '') : '')),
    ]),
  };
  const raw = JSON.stringify(packed);
  if (utf8Length_(raw) > MAX_CACHE_BYTES) return;
  platform_().cachePut(
    `tbl:${sheetName}:${currentVersion_(sheetName)}`,
    raw,
    TABLE_CACHE_TTL_SECONDS,
  );
}

/** Mengganti versi tabel (membuang isi lama dari cache lintas request). */
export function bumpTableVersion_(sheetName: string): void {
  const platform = platform_();
  platform.cachePut(versionKey_(sheetName), platform.uuid(), VERSION_TTL_SECONDS);
}

const dirtyTables_ = new Set<string>();

/** Dipanggil setiap tulis lewat core/db: versi diganti sekarang, dan lagi setelah flush di akhir lock. */
export function markTableDirty_(sheetName: string): void {
  bumpTableVersion_(sheetName);
  dirtyTables_.add(sheetName);
}

/** Dipanggil platform SETELAH flush dan SEBELUM lock dilepas. */
export function finishLockWrites_(): void {
  for (const sheetName of dirtyTables_) bumpTableVersion_(sheetName);
  dirtyTables_.clear();
}
