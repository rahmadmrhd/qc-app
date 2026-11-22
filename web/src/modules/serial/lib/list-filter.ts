import {
  isIsoDate,
  listSerialsTooLong,
  normalizeSerial,
  SERIAL_CUSTODIES,
  SERIAL_LIMITS,
  SERIAL_STATUSES,
  serialProblem,
  splitSerialInput,
} from '@shared/serials';
import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import type { SerialListFilter } from '../queries';
import type { ScanFeedback } from './scan-feedback';

/** Pencarian banyak serial di server: maks. `SERIAL_LIMITS.listSerialsMax` serial (`SerialListInput.serials`, GET: URL harus muat). */
export const SERIAL_SEARCH_MAX = SERIAL_LIMITS.listSerialsMax;

const isoDate = z.string().refine(isIsoDate).optional().catch(undefined);

/** Search params halaman daftar serial; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
/** Larik param filter jamak (maks. `FILTER_LIST_MAX` di server = 20); nilai tak sah membuat seluruh larik dibuang. */
const idList = z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined);

export const serialSearchSchema = z.object({
  /** Serial yang dicari, satu per baris (bentuk ternormalisasi). */
  sn: z.string().max(20_000).optional().catch(undefined),
  /** Item (banyak nilai = salah satu dari). */
  itemIds: idList,
  /** Lokasi (banyak nilai = salah satu dari). */
  locationIds: idList,
  /** Business Unit (banyak nilai = salah satu dari). */
  buIds: idList,
  /** Posisi: di QC, dalam pengiriman, atau di servis (banyak nilai = salah satu dari). */
  custodies: z.array(z.enum(SERIAL_CUSTODIES)).max(FILTER_LIST_MAX).optional().catch(undefined),
  /** Status alur serial (banyak nilai = salah satu dari). */
  statuses: z.array(z.enum(SERIAL_STATUSES)).max(FILTER_LIST_MAX).optional().catch(undefined),
  /** Param tunggal lama (tautan dari View item/lokasi/BU): dibaca sebagai daftar berisi satu nilai. */
  item: z.string().max(100).optional().catch(undefined),
  /** Label item dari tautan lama `item` (agar tampil tanpa memuat opsi). */
  itemLabel: z.string().max(255).optional().catch(undefined),
  loc: z.string().max(100).optional().catch(undefined),
  bu: z.string().max(100).optional().catch(undefined),
  custody: z.enum(SERIAL_CUSTODIES).optional().catch(undefined),
  status: z.enum(SERIAL_STATUSES).optional().catch(undefined),
  /** Hanya yang dicatat oleh akun yang sedang masuk (`createdBy` = email akun). */
  mine: z.literal(true).optional().catch(undefined),
  /**
   * Tampilan "Terhapus" (soft delete; hanya pemegang `serial: manage`). Kunci tersendiri karena `status` di sini adalah
   * status alur serial, bukan status aktif/nonaktif; di antarmuka ia pilihan "Terhapus" pada chip Status (eksklusif
   * terhadap status alur).
   */
  deleted: z.literal(true).optional().catch(undefined),
  from: isoDate,
  to: isoDate,
});
export type SerialSearch = z.infer<typeof serialSearchSchema>;

/** Daftar nilai filter: param jamak, atau param tunggal lama (tautan) sebagai daftar satu nilai. */
export function filterList<T extends string>(plural: T[] | undefined, single: T | undefined): T[] {
  return plural ?? (single ? [single] : []);
}

/** Nilai filter jamak yang berlaku dari search params (param tunggal lama ikut). */
export function searchLists(search: SerialSearch) {
  return {
    buIds: filterList(search.buIds, search.bu),
    itemIds: filterList(search.itemIds, search.item),
    locationIds: filterList(search.locationIds, search.loc),
    statuses: filterList(search.statuses, search.status),
    custodies: filterList(search.custodies, search.custody),
  };
}

/** Tambalan search params yang mengganti satu filter jamak dan membuang param tunggal lamanya. */
export const CLEAR_LEGACY_SINGLE: Pick<
  SerialSearch,
  'bu' | 'item' | 'itemLabel' | 'loc' | 'status' | 'custody'
> = {
  bu: undefined,
  item: undefined,
  itemLabel: undefined,
  loc: undefined,
  status: undefined,
  custody: undefined,
};

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

/** Serial ternormalisasi dari tiap baris teks pencarian (baris kosong dilewati; baris tak sah ikut dinormalkan apa adanya). */
function lineKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split('\n')) {
    const normalized = normalizeSerial(line);
    if (normalized !== '') keys.add(normalized);
  }
  return keys;
}

/**
 * Menambahkan hasil scan kamera (satu atau banyak serial, satu per baris) ke ujung daftar pencarian tanpa duplikat.
 * HANYA baris yang ditambahkan yang dinormalkan: teks yang sudah ada dibiarkan mentah (baris yang belum sah, sedang
 * diketik, atau melebihi batas tidak dibuang atau diubah diam-diam; peringatan batas tetap tampil dari teksnya).
 * Konsekuensi yang disengaja: menambah baris kedua mengubah arti pencarian dari awalan menjadi cocok persis.
 * `feedback`: `added` bila semua yang baru masuk, `duplicate` bila semuanya sudah ada, `rejected` bila tak satu pun
 * sah atau daftar penuh; serial yang masih muat tetap masuk, sisanya tidak (umpan balik `rejected`).
 */
export function mergeScanned(
  currentText: string,
  input: string,
): { text: string; feedback: ScanFeedback } {
  const split = splitSerialInput(input);
  if (split.serials.length === 0) return { text: currentText, feedback: 'rejected' };
  const known = lineKeys(currentText);
  const added = split.serials.filter((serial) => !known.has(serial));
  if (added.length === 0) return { text: currentText, feedback: 'duplicate' };
  const base = currentText.replace(/\n+$/, '');
  const accepted: string[] = [];
  for (const serial of added) {
    const candidate = [...(base === '' ? [] : [base]), ...accepted, serial].join('\n');
    if (normalizeSearchText(candidate).capped) break;
    accepted.push(serial);
  }
  if (accepted.length === 0) return { text: currentText, feedback: 'rejected' };
  const text = [...(base === '' ? [] : [base]), ...accepted].join('\n');
  return { text, feedback: accepted.length === added.length ? 'added' : 'rejected' };
}

/**
 * Enter pada field pencarian (juga penutup bacaan pemindai fisik): menetapkan baris tempat kursor berada (seluruh
 * baris, bukan hanya bagian sebelum kursor); baris lain TIDAK disentuh dan tetap di tempatnya.
 * - tak sah atau sudah ada di baris lain: baris dibuang, umpan balik `rejected`/`duplicate`;
 * - sah: dinormalkan di tempat, kursor pindah ke awal baris berikutnya (baris baru bila ini baris terakhir);
 *   umpan balik `rejected` bila daftar menjadi melebihi batas (baris tetap ada, peringatan batas tampil).
 * Mengembalikan `null` bila baris kosong (Enter tak berbuat apa-apa).
 */
export function commitSearchLine(
  value: string,
  caret: number,
): { text: string; caret: number; feedback: ScanFeedback } | null {
  const start = caret <= 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = value.indexOf('\n', Math.max(caret, start));
  const end = lineEnd === -1 ? value.length : lineEnd;
  const raw = value.slice(start, end);
  if (raw.trim() === '') return null;
  const before = value.slice(0, start);
  const after = lineEnd === -1 ? '' : value.slice(end + 1);
  const normalized = normalizeSerial(raw);
  if (serialProblem(normalized) !== null) {
    return { text: before + after, caret: before.length, feedback: 'rejected' };
  }
  if (lineKeys(`${before}\n${after}`).has(normalized)) {
    return { text: before + after, caret: before.length, feedback: 'duplicate' };
  }
  const text = `${before}${normalized}\n${after}`;
  return {
    text,
    caret: before.length + normalized.length + 1,
    feedback: normalizeSearchText(text).capped ? 'rejected' : 'added',
  };
}

/**
 * Search params -> masukan `serials.list`. Satu serial dikirim sebagai awalan (`query`, juga cocok persis), dua atau
 * lebih sebagai daftar persis (`serials`); keduanya dalam bentuk ternormalisasi. `userEmail` = akun yang masuk, dipakai
 * untuk sakelar "Dicatat oleh saya" (tidak ada rute opsi pengguna bagi pembaca; default perancang OQ-16).
 */
export function filterOfSearch(
  search: SerialSearch,
  userEmail?: string,
  /** Pemegang `serial: manage`: tanpa hak itu `?deleted=true` tulisan tangan diabaikan (server akan menolaknya). */
  canSeeDeleted = true,
): SerialListFilter {
  const lines = normalizeSearchText(search.sn ?? '')
    .text.split('\n')
    .filter((line) => line !== '');
  const lists = searchLists(search);
  const deletedView = search.deleted === true && canSeeDeleted;
  return {
    ...(lines.length === 1 ? { query: normalizeSerial(lines[0] ?? '') } : {}),
    ...(lines.length > 1 ? { serials: lines.join('\n') } : {}),
    ...(lists.itemIds.length > 0 ? { itemIds: lists.itemIds } : {}),
    ...(lists.locationIds.length > 0 ? { locationIds: lists.locationIds } : {}),
    ...(lists.buIds.length > 0 ? { buIds: lists.buIds } : {}),
    ...(lists.custodies.length > 0 ? { custodies: lists.custodies } : {}),
    ...(search.mine && userEmail ? { createdBy: userEmail } : {}),
    ...(lists.statuses.length > 0 ? { statuses: lists.statuses } : {}),
    ...(deletedView ? { deleted: true } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
  };
}
