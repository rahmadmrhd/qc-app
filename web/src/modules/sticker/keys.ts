const sorted = (ids: readonly string[]) => [...ids].sort();

export const stickerKeys = {
  all: ['sticker'] as const,
  types: ['sticker', 'types'] as const,
  list: ['sticker', 'list'] as const,
  /** Semua daftar stok (per kombinasi lokasi). */
  stocks: ['sticker', 'stock'] as const,
  stock: (locationIds: readonly string[]) => ['sticker', 'stock', sorted(locationIds)] as const,
  history: (stickerId: string, locationIds: readonly string[]) =>
    ['sticker', 'history', stickerId, sorted(locationIds)] as const,
};
