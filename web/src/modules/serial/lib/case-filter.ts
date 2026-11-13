import { z } from 'zod';
import type { SerialCaseFilter } from '../queries';

/** Search params halaman Laporan; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
export const caseSearchSchema = z.object({
  /** `active` (bawaan bila kosong), `closed`, atau `all`. */
  status: z.enum(['active', 'closed', 'all']).optional().catch(undefined),
  bu: z.string().max(100).optional().catch(undefined),
  /** Awalan nomor LP atau serial. */
  q: z.string().max(100).optional().catch(undefined),
});
export type CaseSearch = z.infer<typeof caseSearchSchema>;

/** Status yang berlaku: tanpa pilihan = laporan aktif (bawaan, juga bagi tim servis). */
export function effectiveCaseStatus(search: CaseSearch): 'active' | 'closed' | 'all' {
  return search.status ?? 'active';
}

/** Search params -> masukan `serialCases.list` (`all` = tanpa filter status). */
export function caseFilterOfSearch(search: CaseSearch): SerialCaseFilter {
  const status = effectiveCaseStatus(search);
  const query = search.q?.trim() ?? '';
  return {
    ...(status === 'all' ? {} : { status }),
    ...(search.bu ? { buId: search.bu } : {}),
    ...(query !== '' ? { query } : {}),
  };
}
