import {
  isIsoDate,
  listSerialsTooLong,
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
 * Teks pencarian -> serial ternormalisasi satu per baris. Yang dipertahankan adalah awalan daftar: berhenti di serial
 * pertama yang membuat jumlah melebihi `SERIAL_SEARCH_MAX` atau panjang URL ter-encode melebihi batas
 * (`listSerialsTooLong`, fungsi bersama dengan server). `dropped` = serial sah (unik) yang diabaikan; `tooLong` = berhenti
 * karena panjang, bukan jumlah.
 */
export function normalizeSearchText(text: string): {
  text: string;
  count: number;
  capped: boolean;
  dropped: number;
  tooLong: boolean;
} {
  const all = splitSerialInput(text, Number.MAX_SAFE_INTEGER).serials;
  const kept: string[] = [];
  let tooLong = false;
  for (const serial of all) {
    if (kept.length >= SERIAL_SEARCH_MAX) break;
    if (listSerialsTooLong([...kept, serial].join('\n'))) {
      tooLong = true;
      break;
    }
    kept.push(serial);
  }
  return {
    text: kept.join('\n'),
    count: kept.length,
    capped: all.length > kept.length,
    dropped: all.length - kept.length,
    tooLong,
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
