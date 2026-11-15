import { ApiError } from '@/lib/api/api-error';
import type { StagingRow } from './draft';

export interface ItemLookup {
  id: string;
  label: string;
  buOptions: { id: string; code: string }[];
}

/** Banyak id item per permintaan `serials.itemOptions` (batas server) dan jumlah permintaan verifikasi serentak. */
export const ITEM_IDS_PER_REQUEST = 50;
export const VERIFY_CONCURRENCY = 4;

/** Id yang boleh dikirim di `serials.itemOptions` (`itemIds`): tak kosong, maks. 100 unit UTF-16, tanpa koma. */
export function isQueryableItemId(id: string): boolean {
  return id.trim() !== '' && id.length <= 100 && !id.includes(',');
}

export interface VerifyDeps {
  /**
   * Item menurut id (bukan menurut label berkas): hanya yang ada dan terlihat bagi pengguna yang dikembalikan; id yang
   * tak kembali = tidak ditemukan. Maks. `ITEM_IDS_PER_REQUEST` id; galat dilempar bila gagal (jaringan/server).
   */
  findItems(itemIds: readonly string[]): Promise<ItemLookup[]>;
  /** Stiker yang berlaku bagi (item, BU); melempar `ApiError` NOT_FOUND bila pasangan tidak sah. */
  stickersOf(itemId: string, buId: string): Promise<{ id: string; name: string }[]>;
  /** Lokasi yang dapat dipilih (id dan label); `null` = daftar gagal dimuat (baris ditandai belum terverifikasi). */
  locations: readonly { id: string; label: string }[] | null;
}

export const VERIFY_FAILED_MESSAGE =
  'Rujukan belum bisa diverifikasi (jaringan atau server). Impor ulang berkas atau coba simpan lagi';

/** Galat yang berarti rujukannya memang tidak sah (bukan gangguan jaringan atau server). */
export function isReferenceError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'NOT_FOUND' || error.code === 'VALIDATION' || error.code === 'FORBIDDEN')
  );
}

export interface VerifyReport {
  rows: StagingRow[];
  /** Baris yang rujukannya tidak ditemukan dan wajib dipilih ulang. */
  unresolved: number;
  /** Baris yang rujukannya tak dapat diverifikasi karena galat jaringan atau server. */
  unverified: number;
}

/** Menjalankan `fn` atas `items` dengan paling banyak `limit` pekerjaan serentak (urutan hasil = urutan masukan). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type ItemResult = ItemLookup | null | 'error';
type PairResult = { id: string; name: string }[] | null | 'error';

/**
 * Berkas `.qcsn` adalah masukan tak tepercaya: label item, BU, lokasi, dan stiker TIDAK dipakai, melainkan diganti
 * nilai dari server (opsi item, stiker yang berlaku, dan daftar lokasi). BU yang kosong diturunkan dari item bila item
 * hanya punya satu BU yang boleh ditulis. Rujukan yang tak ditemukan ditandai `unresolved`; kegagalan memverifikasi
 * (jaringan) ditandai sebagai galat baris tanpa membuang pilihan stiker.
 */
export async function verifyImported(
  rows: readonly StagingRow[],
  deps: VerifyDeps,
): Promise<VerifyReport> {
  // Id yang pasti ditolak server (kosong, >100 unit UTF-16, atau memuat koma yang memecah daftar GET) disaring SEBELUM
  // dipotong: satu id beracun tidak boleh menjatuhkan id sah lain dalam potongan yang sama. Id itu dianggap tak ditemukan.
  const unusable = new Set<string>();
  const itemIds: string[] = [];
  for (const id of new Set(rows.map((row) => row.itemId))) {
    if (id === '') continue;
    if (isQueryableItemId(id)) itemIds.push(id);
    else unusable.add(id);
  }
  const chunks: string[][] = [];
  for (let at = 0; at < itemIds.length; at += ITEM_IDS_PER_REQUEST) {
    chunks.push(itemIds.slice(at, at + ITEM_IDS_PER_REQUEST));
  }
  const items = new Map<string, ItemResult>();
  for (const id of unusable) items.set(id, null);
  await mapLimit(chunks, VERIFY_CONCURRENCY, async (chunk) => {
    try {
      const found = new Map((await deps.findItems(chunk)).map((item) => [item.id, item]));
      for (const id of chunk) items.set(id, found.get(id) ?? null);
    } catch {
      for (const id of chunk) items.set(id, 'error');
    }
  });

  // BU akhir tiap baris (kosong = belum dapat ditentukan).
  const resolved = rows.map((row) => {
    const lookup = row.itemId === '' ? null : (items.get(row.itemId) ?? null);
    if (lookup === 'error' || lookup === null)
      return { lookup, buId: row.buId, buLabel: row.buLabel };
    const only = lookup.buOptions.length === 1 ? lookup.buOptions[0] : undefined;
    const chosen = row.buId === '' ? only : lookup.buOptions.find((bu) => bu.id === row.buId);
    return { lookup, buId: chosen?.id ?? '', buLabel: chosen?.code ?? '' };
  });

  const pairs = new Map<string, { itemId: string; buId: string }>();
  rows.forEach((row, index) => {
    const info = resolved[index];
    if (info && info.lookup !== null && info.lookup !== 'error' && info.buId !== '') {
      pairs.set(`${row.itemId}|${info.buId}`, { itemId: row.itemId, buId: info.buId });
    }
  });
  const stickers = new Map<string, PairResult>();
  await mapLimit([...pairs], VERIFY_CONCURRENCY, async ([key, pair]) => {
    try {
      stickers.set(key, await deps.stickersOf(pair.itemId, pair.buId));
    } catch (error) {
      stickers.set(key, isReferenceError(error) ? null : 'error');
    }
  });

  const locations = deps.locations
    ? new Map(deps.locations.map((location) => [location.id, location.label]))
    : null;
  let unresolved = 0;
  let unverified = 0;
  const next = rows.map((row, index): StagingRow => {
    const info = resolved[index];
    const flags: ('item' | 'location' | 'stickers')[] = [];
    let failed = false;
    let result: StagingRow = { ...row };

    const lookup = info?.lookup ?? null;
    if (lookup === 'error') {
      failed = true;
    } else if (lookup === null || info === undefined || info.buId === '') {
      flags.push('item');
    } else {
      result = { ...result, itemLabel: lookup.label, buId: info.buId, buLabel: info.buLabel };
      const list = stickers.get(`${row.itemId}|${info.buId}`);
      if (list === 'error') failed = true;
      else if (list === null || list === undefined) flags.push('item');
      else if (row.stickers !== null) {
        const names = new Map(list.map((sticker) => [sticker.id, sticker.name]));
        if (row.stickers.some((sticker) => !names.has(sticker.stickerId))) {
          flags.push('stickers');
          result = { ...result, stickers: null };
        } else {
          result = {
            ...result,
            stickers: row.stickers.map((sticker) => ({
              ...sticker,
              name: names.get(sticker.stickerId) ?? sticker.name,
            })),
          };
        }
      }
    }

    if (locations === null) {
      failed = true;
    } else {
      const locationLabel = locations.get(row.locationId);
      if (locationLabel === undefined) flags.push('location');
      else result = { ...result, locationLabel };
    }

    if (flags.length > 0) {
      unresolved++;
      return { ...result, unresolved: flags };
    }
    if (failed) {
      unverified++;
      return { ...result, result: 'error', message: VERIFY_FAILED_MESSAGE };
    }
    return result;
  });
  return { rows: next, unresolved, unverified };
}
