import type { HandoverStatus } from '@shared/handover';
import { z } from 'zod';

/** Search param `status` pada rute Serah Terima: filter daftar kartu (ponsel) yang dibawa ke detail/ubah dan kembali. */
export const handoverSearchSchema = z.object({
  status: z.enum(['all', 'new', 'in_progress', 'done', 'cancelled']).optional().catch(undefined),
  /** Lokasi yang dibuka dari notifikasi: memuat task/papan lokasi itu tanpa mengubah pilihan lokasi header. */
  loc: z.string().optional().catch(undefined),
  /** Hanya task milik customer ini (tautan dari View customer; keputusan pemilik 2026-11-21). */
  customer: z.string().optional().catch(undefined),
});

export type HandoverSearch = z.infer<typeof handoverSearchSchema>;

export const statusFromSearch = (search: HandoverSearch): HandoverStatus | 'all' =>
  search.status ?? 'all';

/** `all` tidak ditulis ke URL (bawaan). */
export const searchFromStatus = (
  status: HandoverStatus | 'all',
  loc?: string,
  customer?: string,
): HandoverSearch => ({
  ...(status === 'all' ? {} : { status }),
  ...(loc ? { loc } : {}),
  ...(customer ? { customer } : {}),
});

/** Lokasi yang dimuat halaman: `loc` dari URL (notifikasi) bila ada, selain itu pilihan lokasi header. */
export const scopedLocationIds = (
  loc: string | undefined,
  selectedIds: readonly string[],
): readonly string[] => (loc ? [loc] : selectedIds);
