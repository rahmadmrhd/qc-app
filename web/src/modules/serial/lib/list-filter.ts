import { isIsoDate, normalizeSerial, SERIAL_STATUSES, splitSerialInput } from '@shared/serials';
import { z } from 'zod';
import type { SerialListFilter } from '../queries';

/** Pencarian banyak serial di server: maks. 200 baris (`SerialListInput.serials`). */
export const SERIAL_SEARCH_MAX = 200;

const isoDate = z.string().refine(isIsoDate).optional().catch(undefined);

/** Search params halaman daftar serial; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
export const serialSearchSchema = z.object({
  /** Serial yang dicari, satu per baris (bentuk ternormalisasi). */
  sn: z.string().max(20_000).optional().catch(undefined),
  item: z.string().max(100).optional().catch(undefined),
  /** Label item terpilih (agar tampil setelah muat ulang tanpa memuat opsi). */
  itemLabel: z.string().max(255).optional().catch(undefined),
  loc: z.string().max(100).optional().catch(undefined),
  status: z.enum(SERIAL_STATUSES).optional().catch(undefined),
  from: isoDate,
  to: isoDate,
});
export type SerialSearch = z.infer<typeof serialSearchSchema>;

/** Teks pencarian -> serial ternormalisasi satu per baris (dibatasi `SERIAL_SEARCH_MAX`). */
export function normalizeSearchText(text: string): {
  text: string;
  count: number;
  capped: boolean;
} {
  const split = splitSerialInput(text, SERIAL_SEARCH_MAX);
  return { text: split.serials.join('\n'), count: split.serials.length, capped: split.truncated };
}

/**
 * Search params -> masukan `serials.list`. Satu serial dikirim sebagai awalan (`query`, juga cocok persis), dua atau
 * lebih sebagai daftar persis (`serials`); keduanya dalam bentuk ternormalisasi.
 */
export function filterOfSearch(search: SerialSearch): SerialListFilter {
  const lines = normalizeSearchText(search.sn ?? '')
    .text.split('\n')
    .filter((line) => line !== '');
  return {
    ...(lines.length === 1 ? { query: normalizeSerial(lines[0] ?? '') } : {}),
    ...(lines.length > 1 ? { serials: lines.join('\n') } : {}),
    ...(search.item ? { itemId: search.item } : {}),
    ...(search.loc ? { locationId: search.loc } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
  };
}
