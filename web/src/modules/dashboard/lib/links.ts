import type { MeDto } from '@shared/contract';
import type { WidgetId } from '@shared/dashboard';
import type { RowTarget } from '@/components/data-table';
import { can } from '@/modules/auth/permissions';

/** Tautan sebuah widget daftar (quick list): label ke halaman indeks, baris ke halaman detailnya. */
export interface WidgetLinks {
  /** Halaman indeks modul; `null` = tidak ada tautan (tak berhak atau bukan widget daftar). */
  index: RowTarget | null;
  /** Halaman detail menurut `id` baris (kolom tersembunyi `id` dari server); `null` = baris tak dapat dibuka. */
  row: ((id: string) => RowTarget) | null;
}

const NONE: WidgetLinks = { index: null, row: null };

/**
 * Tautan widget daftar (keputusan pemilik 2026-11-25): hanya untuk pemegang izin halaman tujuannya. Widget sendiri
 * sudah mensyaratkan izin modulnya (Serah Terima, Serial, Stok), jadi indeks cukup; detail stiker butuh
 * `sticker: view` tersendiri (stok saja tidak cukup). Halaman publik tak pernah memakai ini.
 */
export function widgetLinks(me: MeDto | null | undefined, id: WidgetId): WidgetLinks {
  switch (id) {
    case 'hs.oldest':
      return {
        index: { to: '/handover' },
        row: (rowId) => ({ to: '/handover/$handoverId', params: { handoverId: rowId } }),
      };
    case 'sn.latest':
      // Satu baris = satu kelompok (item, tanggal, pencatat): tujuannya daftar Serial terfilter item itu.
      return {
        index: { to: '/serial' },
        row: (rowId) => ({ to: '/serial', search: { itemIds: [rowId] } }),
      };
    case 'rp.oldest':
      return {
        index: { to: '/serial/reports' },
        row: (rowId) => ({ to: '/serial/reports/$caseId', params: { caseId: rowId } }),
      };
    case 'st.attention':
      return {
        index: { to: '/sticker' },
        row: can(me, 'sticker', 'view')
          ? (rowId) => ({ to: '/sticker/$stickerId', params: { stickerId: rowId } })
          : null,
      };
    default:
      return NONE;
  }
}
