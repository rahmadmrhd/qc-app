import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import type {
  GetStickerGuideThumbInput,
  ListStickerGuidesInput,
  RemoveStickerGuideInput,
  RenameStickerGuideInput,
  UploadStickerGuideInput,
} from '@shared/contract';
import {
  isImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  matchesImageBytesSignature,
} from '@shared/files';
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

/** Nama gambar: dirapikan (trim), wajib, maks. `nameMax` titik kode (emoji = 1, sama dengan klien). */
export function readGuideName(reader: ObjectReader, key: string): string {
  const value = reader.raw(key);
  if (typeof value !== 'string') {
    reader.fail(key, value === undefined || value === null ? 'Wajib diisi' : 'Harus berupa teks');
    return '';
  }
  const text = value.trim();
  if (text === '') reader.fail(key, 'Wajib diisi');
  else if ([...text].length > GUIDE_LIMITS.nameMax) {
    reader.fail(key, `Maksimal ${GUIDE_LIMITS.nameMax} karakter`);
  }
  return text;
}

const THUMB_MIME_TYPES = ['image/webp', 'image/jpeg'] as const;

function isDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_IMAGE_DIMENSION
  );
}

/**
 * Unggah gambar pustaka: gambar (JPEG/PNG/WebP, maks. `MAX_IMAGE_BYTES`) dan thumbnail (WebP/JPEG, maks.
 * `thumbMaxBytes`) divalidasi dengan tanda tangan byte terhadap MIME yang diklaim; lebar/tinggi bilangan bulat
 * 1..`MAX_IMAGE_DIMENSION`. Isi bukan gambar = `VALIDATION` per field.
 */
export function validateUploadGuide(raw: unknown): UploadStickerGuideInput {
  const reader = readObject(raw);
  const name = readGuideName(reader, 'name');
  const mime = reader.raw('mime');
  const thumbMime = reader.raw('thumbMime');
  const width = reader.raw('width');
  const height = reader.raw('height');
  const image = reader.raw('image');
  const thumbnail = reader.raw('thumbnail');
  if (!isImageMime(mime)) reader.fail('mime', 'Hanya JPEG, PNG, atau WebP');
  const thumbType = THUMB_MIME_TYPES.find((item) => item === thumbMime);
  if (thumbType === undefined) reader.fail('thumbMime', 'Thumbnail hanya WebP atau JPEG');
  if (!isDimension(width)) reader.fail('width', 'Lebar tidak valid');
  if (!isDimension(height)) reader.fail('height', 'Tinggi tidak valid');
  if (!(image instanceof Uint8Array) || image.length === 0) {
    reader.fail('image', 'Isi gambar tidak valid');
  } else if (image.length > MAX_IMAGE_BYTES) {
    reader.fail('image', 'Ukuran gambar maksimal 10 MB');
  } else if (isImageMime(mime) && !matchesImageBytesSignature(mime, image)) {
    reader.fail('image', 'Isi berkas tidak sesuai jenis gambar');
  }
  if (!(thumbnail instanceof Uint8Array) || thumbnail.length === 0) {
    reader.fail('thumbnail', 'Thumbnail tidak valid');
  } else if (thumbnail.length > GUIDE_LIMITS.thumbMaxBytes) {
    reader.fail('thumbnail', 'Thumbnail terlalu besar');
  } else if (thumbType !== undefined && !matchesImageBytesSignature(thumbType, thumbnail)) {
    reader.fail('thumbnail', 'Isi thumbnail tidak sesuai jenis gambar');
  }
  reader.done();
  return {
    name,
    mime: mime as string,
    thumbMime: thumbMime as string,
    width: width as number,
    height: height as number,
    image: image as Uint8Array,
    thumbnail: thumbnail as Uint8Array,
  };
}

export function validateRenameGuide(raw: unknown): RenameStickerGuideInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const name = readGuideName(reader, 'name');
  reader.done();
  return { id, name };
}

export function validateRemoveGuide(raw: unknown): RemoveStickerGuideInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateGetGuideThumb(raw: unknown): GetStickerGuideThumbInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}
