import type { MeDto } from '@shared/contract';
import { can } from '@/modules/auth/permissions';

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

/** Field Merk dan BU di form item. */
export function itemFormLinkAccess(me: MeDto | null | undefined) {
  return { ...brandLinkAccess(me), ...businessUnitLinkAccess(me) };
}
