import type { GuideEntry } from './types';

/** Nama kelompok untuk panduan tanpa `grup`. */
export const UNGROUPED_NAME = 'Lainnya';

export interface GuideGroup<T> {
  name: string;
  items: T[];
}

/**
 * Mengelompokkan panduan menurut fitur (`GuideEntry.grup`) untuk dialog Panduan. Urutan kelompok mengikuti kemunculan
 * pertama di daftar (jadi urutan katalog), urutan di dalam kelompok tetap; yang tanpa `grup` masuk "Lainnya" di akhir.
 */
export function groupGuides<T extends { entry: GuideEntry }>(
  offers: readonly T[],
): GuideGroup<T>[] {
  const groups = new Map<string, T[]>();
  const loose: T[] = [];
  for (const offer of offers) {
    const name = offer.entry.grup;
    if (name === undefined || name === '') {
      loose.push(offer);
      continue;
    }
    const items = groups.get(name);
    if (items) items.push(offer);
    else groups.set(name, [offer]);
  }
  const result = [...groups].map(([name, items]) => ({ name, items }));
  if (loose.length > 0) result.push({ name: UNGROUPED_NAME, items: loose });
  return result;
}
