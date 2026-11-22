import type { HandoverStatus } from '@shared/handover';
import { z } from 'zod';

/** Search param `status` pada rute Serah Terima: filter daftar kartu (ponsel) yang dibawa ke detail/ubah dan kembali. */
export const handoverSearchSchema = z.object({
  status: z.enum(['all', 'new', 'in_progress', 'done', 'cancelled']).optional().catch(undefined),
  /** Lokasi yang dibuka dari notifikasi: memuat task/papan lokasi itu tanpa mengubah pilihan lokasi header. */
  loc: z.string().optional().catch(undefined),
  /** Hanya task milik customer ini (banyak nilai = salah satu dari; chip Customer papan). */
  customers: z.array(z.string().max(100)).max(20).optional().catch(undefined),
  /**
   * Id satu customer: tautan dari View customer (keputusan pemilik 2026-11-21) yang masih diterima; dibaca sebagai
   * `customers` lewat `customersOfSearch`.
   */
  customer: z.string().optional().catch(undefined),
  /** Tampilan Terhapus (hanya bagi `handover: manage`; fase 4d). */
  deleted: z.literal(true).optional().catch(undefined),
  /** Tab View task (`catatan` bawaan). */
  tab: z.enum(['catatan', 'riwayat']).optional().catch(undefined),
});

export type HandoverSearch = z.infer<typeof handoverSearchSchema>;

/** Customer yang disaring: param jamak, atau param tunggal lama (tautan) sebagai daftar satu nilai. */
export const customersOfSearch = (search: HandoverSearch): string[] =>
  search.customers ?? (search.customer ? [search.customer] : []);

export const statusFromSearch = (search: HandoverSearch): HandoverStatus | 'all' =>
  search.status ?? 'all';

/** `all` tidak ditulis ke URL (bawaan). */
export const searchFromStatus = (
  status: HandoverStatus | 'all',
  loc?: string,
  customers?: readonly string[],
  deleted?: boolean,
): HandoverSearch => ({
  ...(status === 'all' ? {} : { status }),
  ...(loc ? { loc } : {}),
  ...(customers && customers.length > 0 ? { customers: [...customers] } : {}),
  ...(deleted ? { deleted: true as const } : {}),
});

/** Lokasi yang dimuat halaman: `loc` dari URL (notifikasi) bila ada, selain itu pilihan lokasi header. */
export const scopedLocationIds = (
  loc: string | undefined,
  selectedIds: readonly string[],
): readonly string[] => (loc ? [loc] : selectedIds);
