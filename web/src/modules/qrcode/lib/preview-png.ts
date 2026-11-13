/** Sisi terpanjang gambar contoh stiker yang dicoba berurutan (px) sampai muat di batas ukuran server. */
export const PREVIEW_SIDES = [800, 512, 320] as const;

/** Ukuran gambar contoh: sisi terpanjang dibatasi `max` px dengan rasio dipertahankan; tidak pernah membesarkan. */
export function fitPreviewSize(
  width: number,
  height: number,
  max: number = PREVIEW_SIDES[0],
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
