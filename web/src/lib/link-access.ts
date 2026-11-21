import type { MeDto } from '@shared/contract';
import {
  can,
  canCreateItem,
  canManageAnyItem,
  liveBuIdsWithLevelOf,
} from '@/modules/auth/permissions';

/**
 * Tautan "buka record" dan izin "tambah" pada field relasi (`LinkField`/`LinkMultiField`). Semuanya hanya untuk UX
 * (penegakan ada di server): tombol/baris hanya muncul bila user berhak, dan "buka" mengarah ke halaman LIHAT record
 * (bukan daftar). Model tanpa halaman lihat (jenis stiker, preset QR) tidak punya tautan buka.
 * Satu tempat untuk semua form agar aturan Tambah/Buka sama di mana pun field relasi itu muncul.
 */

/** BU: halaman lihat ada di Pengaturan Akses (`access: view`), tambah butuh `access: manage` (sama dengan halaman BU). */
export function businessUnitLinkAccess(me: MeDto | null | undefined) {
  return {
    openBusinessUnitHref: can(me, 'access', 'view')
      ? (id: string) => `/access/business-units/${encodeURIComponent(id)}`
      : undefined,
    canCreateBusinessUnit: can(me, 'access', 'manage'),
  };
}

/**
 * Lokasi: halaman lihat (`/access/locations/$locationId`) butuh `access: view`; tambah butuh `access: manage` (sama
 * dengan halaman Lokasi; keputusan pemilik 18). `LocationField` (form tulis modul berlokasi) tetap tanpa Tambah/Buka.
 */
export function locationLinkAccess(me: MeDto | null | undefined) {
  return {
    openLocationHref: can(me, 'access', 'view')
      ? (id: string) => `/access/locations/${encodeURIComponent(id)}`
      : undefined,
    canCreateLocation: can(me, 'access', 'manage'),
  };
}

/** Role: halaman lihat (`/access/roles/$roleId`) butuh `access: view`; tambah butuh `access: manage`. */
export function roleLinkAccess(me: MeDto | null | undefined) {
  return {
    openRoleHref: can(me, 'access', 'view')
      ? (id: string) => `/access/roles/${encodeURIComponent(id)}`
      : undefined,
    canCreateRole: can(me, 'access', 'manage'),
  };
}

/** Customer: halaman lihat (`/customer/$customerId`) butuh `item: view` (izin tak diubah; keputusan pemilik 15c). */
export function customerLinkAccess(me: MeDto | null | undefined) {
  return {
    openCustomerHref: can(me, 'item', 'view')
      ? (id: string) => `/customer/${encodeURIComponent(id)}`
      : undefined,
  };
}

/**
 * Tautan "Lihat task Serah Terima customer ini" di View customer (keputusan pemilik 2026-11-21): ke papan Serah Terima
 * yang disaring customer (`/handover?customer=<id>`). Hanya untuk pemegang `handover: view` (bukan sekadar `qc: edit`,
 * yang membuka papan tetapi bukan pembaca Serah Terima).
 */
export function customerHandoversLinkAccess(me: MeDto | null | undefined) {
  return { canViewHandovers: can(me, 'handover', 'view') };
}

/** Merk: halaman lihat butuh `item: view`. */
export function brandLinkAccess(me: MeDto | null | undefined) {
  return {
    openBrandHref: can(me, 'item', 'view')
      ? (id: string) => `/item/brands/${encodeURIComponent(id)}`
      : undefined,
  };
}

/**
 * Jenis stiker: halaman lihat (`/sticker/types/$typeId`) butuh `sticker: view` (membaca katalog); tambah butuh
 * `sticker: edit` (sama dengan rute `stickerTypes.save`).
 */
export function stickerTypeLinkAccess(me: MeDto | null | undefined) {
  return {
    openStickerTypeHref: can(me, 'sticker', 'view')
      ? (id: string) => `/sticker/types/${encodeURIComponent(id)}`
      : undefined,
    canCreateStickerType: can(me, 'sticker', 'edit'),
  };
}

/**
 * Stiker: halaman lihat (`/sticker/$stickerId`) butuh `sticker: view`; tambah butuh `sticker: edit` (sama dengan
 * rute `stickers.save`).
 */
export function stickerLinkAccess(me: MeDto | null | undefined) {
  return {
    openStickerHref: can(me, 'sticker', 'view')
      ? (id: string) => `/sticker/${encodeURIComponent(id)}`
      : undefined,
    canCreateSticker: can(me, 'sticker', 'edit'),
  };
}

/**
 * Item pada field relasi (mis. form QR Manual Book): halaman lihat butuh `item: view`; Tambah butuh `item: edit` pada
 * minimal satu BU aktif (`canCreateItem`, sama dengan halaman Tambah item; keputusan pemilik 18). Dialog Tambah:
 * `ItemFormDialog`. `canOpenDeleted`: tautan ke View item TERHAPUS hanya bagi pemegang `manage` (pemulih; soft delete
 * §4.4), selain itu item terhapus tampil bertanda tanpa tautan.
 */
export function itemLinkAccess(me: MeDto | null | undefined) {
  return {
    openItemHref: can(me, 'item', 'view')
      ? (id: string) => `/item/${encodeURIComponent(id)}`
      : undefined,
    canCreate: canCreateItem(me),
    canOpenDeleted: canManageAnyItem(me),
  };
}

/**
 * Tambah item dari pemilih Item modul Serial Number (keputusan pemilik 2026-11-20, spek redesain butir 29): BU dialog =
 * IRISAN BU aktif tempat user memegang `item: edit` DAN `serial: edit` (BU terhapus tidak ditawarkan), karena
 * `serials.itemOptions` hanya memuat BU `serial: edit`. Irisan kosong = `canCreate` false (baris Tambah tersembunyi).
 */
export function serialItemCreateAccess(me: MeDto | null | undefined) {
  const serialEdit = new Set(liveBuIdsWithLevelOf(me, 'serial', 'edit'));
  const active = new Set(
    (me?.businessUnits ?? []).filter((bu) => bu.status === 'active').map((bu) => bu.id),
  );
  const allowedBuIds = liveBuIdsWithLevelOf(me, 'item', 'edit').filter(
    (id) => serialEdit.has(id) && active.has(id),
  );
  return { canCreate: allowedBuIds.length > 0, allowedBuIds };
}

/**
 * Konfigurasi QR Manual Book milik item (detail item): tautan ke halaman LIHAT konfigurasi (`/qrcode/$designId`),
 * jadi cukup `qrcode: view` (redesain fase 4b: setiap model punya View; sebelumnya ke halaman ubah, `qrcode: edit`).
 */
export function manualBookLinkAccess(me: MeDto | null | undefined) {
  return {
    openManualBookHref: can(me, 'qrcode', 'view')
      ? (designId: string) => `/qrcode/${encodeURIComponent(designId)}`
      : undefined,
  };
}

/**
 * Preset QR ("Default QR") pada field relasi: menunya hanya untuk pengelola (`qrcode: manage`, seperti halaman
 * `/qrcode/default`), jadi View preset dan baris "Tambah preset" juga `qrcode: manage` (rute `qrcodes.savePreset`).
 * Dialog Tambah: `QrPresetFormDialog` (keputusan pemilik 18).
 */
export function qrPresetLinkAccess(me: MeDto | null | undefined) {
  const manage = can(me, 'qrcode', 'manage');
  return {
    openPresetHref: manage
      ? (presetId: string) => `/qrcode/default/${encodeURIComponent(presetId)}`
      : undefined,
    canCreate: manage,
  };
}

/** Halaman lihat catatan Postel (`/postel/$postelId`): butuh `sticker: view`; tanpa izin = tanpa tautan (`null`). */
export function postelLinkAccess(me: MeDto | null | undefined) {
  const allowed = can(me, 'sticker', 'view');
  return {
    openPostelHref: (id: string): string | null =>
      allowed ? `/postel/${encodeURIComponent(id)}` : null,
  };
}

/** Field Merk, BU, serta stiker dan jenis stiker (editor instruksi) di form item. */
export function itemFormLinkAccess(me: MeDto | null | undefined) {
  return {
    ...brandLinkAccess(me),
    ...businessUnitLinkAccess(me),
    ...stickerLinkAccess(me),
    ...stickerTypeLinkAccess(me),
  };
}
