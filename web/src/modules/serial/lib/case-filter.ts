import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import type { SerialCaseFilter } from '../queries';

/** Search params halaman Laporan; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
export const caseSearchSchema = z.object({
  /** `active` (bawaan bila kosong), `closed`, atau `all`. */
  status: z.enum(['active', 'closed', 'all']).optional().catch(undefined),
  /** Business Unit (banyak nilai = salah satu dari). */
  buIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  /** Id satu BU: param tunggal lama yang masih diterima; dibaca sebagai `buIds`. */
  bu: z.string().max(100).optional().catch(undefined),
  /** Awalan nomor LP atau serial. */
  q: z.string().max(100).optional().catch(undefined),
});
export type CaseSearch = z.infer<typeof caseSearchSchema>;

/** BU yang berlaku: param jamak, atau param tunggal lama sebagai daftar satu nilai. */
export function effectiveBuIds(search: CaseSearch): string[] {
  return search.buIds ?? (search.bu ? [search.bu] : []);
}

/** Status yang berlaku: tanpa pilihan = laporan aktif (bawaan, juga bagi tim servis). */
export function effectiveCaseStatus(search: CaseSearch): 'active' | 'closed' | 'all' {
  return search.status ?? 'active';
}

/** Search params -> masukan `serialCases.list` (`all` = tanpa filter status). */
export function caseFilterOfSearch(search: CaseSearch): SerialCaseFilter {
  const status = effectiveCaseStatus(search);
  const query = search.q?.trim() ?? '';
  const buIds = effectiveBuIds(search);
  return {
    ...(status === 'all' ? {} : { status }),
    ...(buIds.length > 0 ? { buIds } : {}),
    ...(query !== '' ? { query } : {}),
  };
}
