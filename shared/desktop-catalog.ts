// Katalog Tipe offline untuk aplikasi desktop (Country Lock; spek desktop §6.6, keputusan pemilik 2026-11-16).
// Potret utuh item `isCountryLock` aktif beserta instruksi penempelan stiker yang SUDAH diselesaikan server
// (`ItemStickerPhotoDto.resolved`): desktop menyimpan hasilnya apa adanya, tanpa menghitung ulang aturan jenis→stiker.
// Murni (tanpa API runtime/DOM): dipakai server (penyusun), desktop (pemvalidasi cache), dan web (tampilan).

import type { BusinessUnitRefDto, ItemStickerPhotoDto } from './contract';
import type { StickerRule, StickerStatus, StickerSystemKind } from './stickers';

export const DESKTOP_CATALOG_VERSION = 1;

/** Id berkas aman dipakai sebagai nama berkas/jalur URL: tanpa pemisah jalur, titik, atau karakter kontrol. */
export const CATALOG_FILE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Berkas gambar katalog (gambar pustaka instruksi dan gambar stiker): `size` memverifikasi unduhan. */
export interface CatalogFileDto {
  id: string;
  mime: string;
  size: number;
}

export interface CatalogStickerTypeDto {
  id: string;
  name: string;
  rule: StickerRule;
  systemKind: StickerSystemKind;
}

export interface CatalogStickerDto {
  id: string;
  typeId: string;
  name: string;
  alias: string;
  /** Id berkas gambar stiker (ada di `files` bila terunduh), atau `null`. */
  fileId: string | null;
  status: StickerStatus;
}

export interface CatalogItemDto {
  id: string;
  brand: string;
  model: string;
  aliases: string[];
  businessUnits: BusinessUnitRefDto[];
  /** Stiker yang berlaku bagi item menurut aturan jenis (stiker aktif; urut nama), sudah diselesaikan server. */
  stickerIds: string[];
  stickerPhotos: ItemStickerPhotoDto[];
}

export interface DesktopCatalogDto {
  version: typeof DESKTOP_CATALOG_VERSION;
  items: CatalogItemDto[];
  stickerTypes: CatalogStickerTypeDto[];
  stickers: CatalogStickerDto[];
  /** Semua berkas yang dirujuk katalog (hanya ini yang boleh diunduh lewat rute berkas). */
  files: CatalogFileDto[];
}

/** Batas pemeriksaan bentuk (melindungi cache dari respons salah isi/terlalu besar). */
export const CATALOG_LIMITS = {
  items: 5000,
  stickers: 5000,
  files: 20000,
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isArrayOf = (value: unknown, limit: number, check: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length <= limit && value.every(check);

function validFile(entry: unknown): boolean {
  return (
    isObject(entry) &&
    isString(entry.id) &&
    CATALOG_FILE_ID.test(entry.id) &&
    isString(entry.mime) &&
    entry.mime.length <= 100 &&
    typeof entry.size === 'number' &&
    Number.isInteger(entry.size) &&
    entry.size >= 0
  );
}

function validSticker(entry: unknown): boolean {
  return (
    isObject(entry) &&
    isString(entry.id) &&
    isString(entry.typeId) &&
    isString(entry.name) &&
    isString(entry.alias) &&
    (entry.fileId === null || (isString(entry.fileId) && CATALOG_FILE_ID.test(entry.fileId))) &&
    (entry.status === 'active' || entry.status === 'inactive' || entry.status === 'deprecated')
  );
}

function validType(entry: unknown): boolean {
  return (
    isObject(entry) &&
    isString(entry.id) &&
    isString(entry.name) &&
    (entry.rule === 'bu' || entry.rule === 'none' || entry.rule === 'group') &&
    isString(entry.systemKind)
  );
}

function validPhoto(entry: unknown): boolean {
  return (
    isObject(entry) &&
    isString(entry.guideId) &&
    CATALOG_FILE_ID.test(entry.guideId) &&
    isString(entry.guideName) &&
    typeof entry.width === 'number' &&
    typeof entry.height === 'number' &&
    isString(entry.caption) &&
    Array.isArray(entry.marks)
  );
}

function validItem(entry: unknown): boolean {
  return (
    isObject(entry) &&
    isString(entry.id) &&
    isString(entry.brand) &&
    isString(entry.model) &&
    isArrayOf(entry.aliases, 100, isString) &&
    Array.isArray(entry.businessUnits) &&
    isArrayOf(entry.stickerIds, CATALOG_LIMITS.stickers, isString) &&
    isArrayOf(entry.stickerPhotos, 100, validPhoto)
  );
}

/**
 * Memeriksa bentuk katalog dari server (atau cache lokal) dan mengembalikannya, atau `null` bila rusak. Yang dijaga:
 * versi, jenis tiap bidang, batas jumlah, dan id berkas yang aman dipakai sebagai nama berkas; isi `marks` foto
 * diteruskan apa adanya (hanya ditampilkan, tak pernah dipakai sebagai jalur).
 */
export function parseDesktopCatalog(value: unknown): DesktopCatalogDto | null {
  if (!isObject(value) || value.version !== DESKTOP_CATALOG_VERSION) return null;
  if (
    !isArrayOf(value.items, CATALOG_LIMITS.items, validItem) ||
    !isArrayOf(value.stickerTypes, CATALOG_LIMITS.stickers, validType) ||
    !isArrayOf(value.stickers, CATALOG_LIMITS.stickers, validSticker) ||
    !isArrayOf(value.files, CATALOG_LIMITS.files, validFile)
  ) {
    return null;
  }
  return value as unknown as DesktopCatalogDto;
}

/** Id semua berkas yang dirujuk katalog (foto instruksi dan gambar stiker); daftar `files` memuat mime dan ukurannya. */
export function catalogFileIds(catalog: DesktopCatalogDto): Set<string> {
  const ids = new Set<string>();
  for (const item of catalog.items) {
    for (const photo of item.stickerPhotos) ids.add(photo.guideId);
  }
  for (const sticker of catalog.stickers) {
    if (sticker.fileId !== null) ids.add(sticker.fileId);
  }
  return ids;
}
