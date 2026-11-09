import { readObject } from '@server/core/validate';
import type { GetStickerGuideThumbInput, ListStickerGuidesInput } from '@shared/contract';
import { GUIDE_LIMITS, GUIDE_SORTS, type GuideSort } from '@shared/stickers';

/** Memotong menurut titik kode (emoji = 1), sama dengan penghitungan batas nama di klien. */
function clip(text: string, max: number): string {
  const points = [...text];
  return points.length > max ? points.slice(0, max).join('') : text;
}

/**
 * Daftar pustaka: `limit` 1..`pageMax` (bawaan `pageDefault`), `sort` ∈ `GUIDE_SORTS` (bawaan `newest`), `search`
 * dirapikan lalu dipangkas ke `nameMax`. `cursor` dibawa apa adanya: kursor yang tak terurai dianggap tanpa kursor
 * oleh servis (keputusan pemilik: sama dengan riwayat stok; klien yang menyimpan kursor lama tak dijatuhkan).
 */
export function validateListGuides(raw: unknown): ListStickerGuidesInput {
  const reader = readObject(raw);
  const sortRaw = reader.raw('sort');
  let sort: GuideSort = 'newest';
  if (sortRaw !== undefined && sortRaw !== null) {
    const match = GUIDE_SORTS.find((item) => item === sortRaw);
    if (match === undefined) reader.fail('sort', 'Urutan tidak valid');
    else sort = match;
  }
  const searchRaw = reader.raw('search');
  let search = '';
  if (searchRaw !== undefined && searchRaw !== null) {
    if (typeof searchRaw === 'string') search = clip(searchRaw.trim(), GUIDE_LIMITS.nameMax);
    else reader.fail('search', 'Harus berupa teks');
  }
  const flag = (key: 'mine' | 'unused'): boolean => {
    const value = reader.raw(key);
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    reader.fail(key, 'Harus berupa true atau false');
    return false;
  };
  const mine = flag('mine');
  const unused = flag('unused');
  const limitRaw = reader.raw('limit');
  let limit: number = GUIDE_LIMITS.pageDefault;
  if (limitRaw !== undefined && limitRaw !== null) {
    if (
      typeof limitRaw === 'number' &&
      Number.isInteger(limitRaw) &&
      limitRaw >= 1 &&
      limitRaw <= GUIDE_LIMITS.pageMax
    ) {
      limit = limitRaw;
    } else {
      reader.fail('limit', `Batas halaman harus 1-${GUIDE_LIMITS.pageMax}`);
    }
  }
  const cursorRaw = reader.raw('cursor');
  reader.done();
  return {
    sort,
    search,
    mine,
    unused,
    limit,
    ...(typeof cursorRaw === 'string' && cursorRaw !== '' ? { cursor: cursorRaw } : {}),
  };
}

export function validateGetGuideThumb(raw: unknown): GetStickerGuideThumbInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}
