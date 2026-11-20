import type { MeDto } from '@shared/contract';
import { can, canCreateItem, liveBuIdsWithLevelOf } from '@/modules/auth/permissions';

/**
 * Tautan "buka record" dan izin "tambah" pada field relasi (`LinkField`/`LinkMultiField`). Semuanya hanya untuk UX
 * (penegakan ada di server): tombol/baris hanya muncul bila user berhak, dan "buka" mengarah ke halaman LIHAT record
 * (bukan daftar). Model tanpa halaman lihat (jenis stiker, preset QR, lokasi, role) tidak punya tautan buka.
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

/** Merk: halaman lihat butuh `item: view`. */
export function brandLinkAccess(me: MeDto | null | undefined) {
  return {
    openBrandHref: can(me, 'item', 'view')
      ? (id: string) => `/item/brands/${encodeURIComponent(id)}`
      : undefined,
  };
}

/** Jenis stiker: tidak ada halaman lihat; tambah butuh `sticker: edit` (sama dengan rute `stickerTypes.save`). */
export function stickerTypeLinkAccess(me: MeDto | null | undefined) {
  return { canCreateStickerType: can(me, 'sticker', 'edit') };
}

/** Stiker: tidak ada halaman lihat; tambah butuh `sticker: edit` (sama dengan rute `stickers.save`). */
export function stickerLinkAccess(me: MeDto | null | undefined) {
  return { canCreateSticker: can(me, 'sticker', 'edit') };
}

/**
 * Item pada field relasi (mis. form QR Manual Book): halaman lihat butuh `item: view`; Tambah butuh `item: edit` pada
 * minimal satu BU aktif (`canCreateItem`, sama dengan halaman Tambah item; keputusan pemilik 18). Dialog Tambah:
 * `ItemFormDialog`.
 */
export function itemLinkAccess(me: MeDto | null | undefined) {
  return {
    openItemHref: can(me, 'item', 'view')
      ? (id: string) => `/item/${encodeURIComponent(id)}`
      : undefined,
    canCreate: canCreateItem(me),
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
 * Konfigurasi QR Manual Book milik item (detail item): tautan ke halaman ubah konfigurasi, jadi butuh `qrcode: edit`
 * (sama dengan rute `/qrcode/$designId/edit`).
 */
export function manualBookLinkAccess(me: MeDto | null | undefined) {
  return {
    openManualBookHref: can(me, 'qrcode', 'edit')
      ? (designId: string) => `/qrcode/${encodeURIComponent(designId)}/edit`
      : undefined,
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
