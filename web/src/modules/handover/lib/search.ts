import type { HandoverStatus } from '@shared/handover';
import { z } from 'zod';

/** Search param `status` pada rute Serah Terima: filter daftar kartu (ponsel) yang dibawa ke detail/ubah dan kembali. */
export const handoverSearchSchema = z.object({
  status: z.enum(['all', 'new', 'in_progress', 'done', 'cancelled']).optional().catch(undefined),
});

export type HandoverSearch = z.infer<typeof handoverSearchSchema>;

export const statusFromSearch = (search: HandoverSearch): HandoverStatus | 'all' =>
  search.status ?? 'all';

/** `all` tidak ditulis ke URL (bawaan). */
export const searchFromStatus = (status: HandoverStatus | 'all'): HandoverSearch =>
  status === 'all' ? {} : { status };
