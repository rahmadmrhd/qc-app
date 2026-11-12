import {
  isIsoDate,
  normalizeSerial,
  SERIAL_LIMITS,
  SERIAL_STATUSES,
  splitSerialInput,
} from '@shared/serials';
import { z } from 'zod';
import type { SerialListFilter } from '../queries';

/** Pencarian banyak serial di server: maks. `SERIAL_LIMITS.listSerialsMax` serial (`SerialListInput.serials`, GET: URL harus muat). */
export const SERIAL_SEARCH_MAX = SERIAL_LIMITS.listSerialsMax;

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

/**
 * Teks pencarian -> serial ternormalisasi satu per baris, dibatasi `SERIAL_SEARCH_MAX`; `dropped` = jumlah serial sah
 * (unik) di atas batas yang diabaikan.
 */
export function normalizeSearchText(text: string): {
  text: string;
  count: number;
  capped: boolean;
  dropped: number;
} {
  const split = splitSerialInput(text, Number.MAX_SAFE_INTEGER);
  const kept = split.serials.slice(0, SERIAL_SEARCH_MAX);
  return {
    text: kept.join('\n'),
    count: kept.length,
    capped: split.serials.length > SERIAL_SEARCH_MAX,
    dropped: Math.max(0, split.serials.length - SERIAL_SEARCH_MAX),
  };
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
