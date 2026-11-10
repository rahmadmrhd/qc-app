import type { MeDto } from '@shared/contract';
import { can } from '@/modules/auth/permissions';

/**
 * Tautan "buka record" dan izin "tambah" pada field Merk/BU di form item. Semuanya hanya untuk UX (penegakan ada di
 * server): tombol/baris hanya muncul bila user berhak, dan "buka" mengarah ke halaman LIHAT record (bukan daftar).
 */
export function itemFormLinkAccess(me: MeDto | null | undefined) {
  return {
    /** Halaman lihat merk: butuh `item: view`. */
    openBrandHref: can(me, 'item', 'view')
      ? (id: string) => `/item/brands/${encodeURIComponent(id)}`
      : undefined,
    /** Halaman lihat BU ada di Pengaturan Akses: butuh `access: view`. */
    openBusinessUnitHref: can(me, 'access', 'view')
      ? (id: string) => `/access/business-units/${encodeURIComponent(id)}`
      : undefined,
    /** Tambah BU: butuh `access: manage` (sama dengan halaman BU). */
    canCreateBusinessUnit: can(me, 'access', 'manage'),
    /**
     * Tambah stiker/jenis dari editor instruksi: butuh `sticker: edit`. Tanpa tautan "Buka": stiker dan jenis tidak
     * punya halaman lihat sendiri (pengecualian aturan LinkField, disetujui 2026-11-10).
     */
    canCreateSticker: can(me, 'sticker', 'edit'),
    canCreateStickerType: can(me, 'sticker', 'edit'),
  };
}
