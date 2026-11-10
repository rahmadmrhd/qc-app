import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { INSTRUCTION_LIMITS, type StickerMarkTarget } from '@shared/stickers';

/** Jepit ke 0..1000 dan bulatkan (permil). Nilai tak hingga atau NaN menjadi 0. */
export function clampPermil(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(INSTRUCTION_LIMITS.coordMax, Math.max(0, Math.round(value)));
}

/**
 * Titik layar -> posisi permil pada foto. `rect` = kotak gambar di layar (`getBoundingClientRect`); titik di luar
 * kotak dijepit di tepi, kotak tanpa ukuran (belum terukur) menghasilkan 0.
 */
export function pointToPermil(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clampPermil(((point.clientX - rect.left) / rect.width) * INSTRUCTION_LIMITS.coordMax),
    y: clampPermil(((point.clientY - rect.top) / rect.height) * INSTRUCTION_LIMITS.coordMax),
  };
}

/** Salinan dalam penanda (tidak berbagi referensi dengan sumber), dipakai saat menyalin penanda dari item lain. */
export function copyMarks(source: readonly ItemStickerMarkDto[]): ItemStickerMarkDto[] {
  return source.map((mark) => ({
    x: mark.x,
    y: mark.y,
    target: { ...mark.target },
    note: mark.note,
  }));
}

/** Daftar baru dengan elemen `from` dipindah ke `to` (dijepit ke rentang); `from` tak sah = salinan apa adanya. */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (!Number.isInteger(from) || from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(Math.trunc(to), 0), next.length - 1);
  if (target === from) return next;
  const [entry] = next.splice(from, 1);
  next.splice(target, 0, entry as T);
  return next;
}

const INACTIVE_SUFFIX = ' — nonaktif';

/**
 * Label sasaran penanda untuk LinkField/daftar: nama stiker, atau "Jenis {nama}"; yang nonaktif diberi tanda
 * "— nonaktif" (penanda tersimpan tetap utuh walau stiker/jenisnya kemudian dinonaktifkan). Id kosong = teks kosong.
 */
export function markLabel(
  target: StickerMarkTarget,
  stickers: readonly StickerDto[],
  types: readonly StickerTypeDto[],
): string {
  if (target.kind === 'sticker') {
    if (target.stickerId === '') return '';
    const found = stickers.find((sticker) => sticker.id === target.stickerId);
    if (!found) return 'Stiker tidak ditemukan';
    return found.status === 'inactive' ? `${found.name}${INACTIVE_SUFFIX}` : found.name;
  }
  if (target.typeId === '') return '';
  const found = types.find((type) => type.id === target.typeId);
  if (!found) return 'Jenis tidak ditemukan';
  return found.status === 'inactive'
    ? `Jenis ${found.name}${INACTIVE_SUFFIX}`
    : `Jenis ${found.name}`;
}
