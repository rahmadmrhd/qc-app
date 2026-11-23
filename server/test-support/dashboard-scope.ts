import type { ResolvedScope } from '@server/modules/dashboard/scope';
import type { DashboardRange } from '@shared/dashboard';
import { bucketFor, previousRange, wibRangeToUtc } from '@shared/dashboard';

/**
 * `ResolvedScope` untuk tes widget tanpa lewat `resolveScope`: semua daftar hak kosong (= tidak ada) kecuali ditimpa
 * lewat `overrides`, `serialLocationIds` `null` (tanpa filter lokasi Serial).
 */
export function testScope(
  range: DashboardRange,
  overrides: Partial<ResolvedScope> = {},
): ResolvedScope {
  const current = wibRangeToUtc(range);
  const previous = wibRangeToUtc(previousRange(range));
  return {
    range,
    bucket: bucketFor(range),
    fromIso: current.fromIso,
    toIso: current.toIso,
    prevFromIso: previous.fromIso,
    prevToIso: previous.toIso,
    today: range.to,
    buIds: [],
    handoverLocationIds: [],
    stockLocationIds: [],
    serialLocationIds: null,
    ...overrides,
  };
}
