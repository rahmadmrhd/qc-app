const sorted = (ids: readonly string[]) => [...ids].sort();

export const stickerKeys = {
  all: ['sticker'] as const,
  types: ['sticker', 'types'] as const,
  list: ['sticker', 'list'] as const,
  /** Pustaka gambar acuan penempelan stiker (tahap 3b-1); kunci query daftar memakai `stickerGuideSource.key` sebagai awalan. */
  guides: ['sticker-guides'] as const,
  /** Item yang memakai satu gambar pustaka (di bawah awalan `guides`: ikut ditandai basi bersama pustaka). */
  guideUsages: (guideId: string) => ['sticker-guides', 'usages', guideId] as const,
  /** Semua daftar stok (per kombinasi lokasi). */
  stocks: ['sticker', 'stock'] as const,
  stock: (locationIds: readonly string[]) => ['sticker', 'stock', sorted(locationIds)] as const,
  history: (stickerId: string, locationIds: readonly string[]) =>
    ['sticker', 'history', stickerId, sorted(locationIds)] as const,
};
