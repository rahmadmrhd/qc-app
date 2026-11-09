/** Batas katalog dan stok stiker (rencana 2026-11-09, Global Constraints). */
export const STICKER_LIMITS = {
  /** Panjang maksimum nama stiker (karakter). */
  nameMax: 120,
  /** Panjang maksimum alias stiker (karakter). */
  aliasMax: 120,
  /** Panjang maksimum alasan koreksi/catatan stok (karakter). */
  reasonMax: 300,
  /** Batas jumlah butir per catatan dan batas minimum stok. */
  qtyMax: 1_000_000,
  /** Maksimum baris lembar per hitungan. */
  countRows: 20,
  /** Maksimum pasangan stiker×lokasi per stok opname. */
  opnameRows: 100,
} as const;

/** Aturan penentuan stiker yang berlaku bagi sebuah item. */
export const STICKER_RULES = ['bu', 'none'] as const;
export type StickerRule = (typeof STICKER_RULES)[number];

/** Jenis entri riwayat stok. */
export const STOCK_ENTRY_KINDS = ['in', 'out', 'adjust', 'opname'] as const;
export type StockEntryKind = (typeof STOCK_ENTRY_KINDS)[number];

/** Hitungan stok: baris lembar (lembar × isi per lembar) dan butir lepas. */
export interface StockCount {
  rows: { sheets: number; perSheet: number }[];
  loose: number;
}

/** Jumlah butir sebuah hitungan: Σ lembar × isi per lembar + butir lepas. */
export function piecesOfCount(count: StockCount): number {
  let total = count.loose;
  for (const row of count.rows) {
    total += row.sheets * row.perSheet;
  }
  return total;
}

/** Menipis: stiker aktif, batas minimum > 0, dan total semua lokasi <= batas. */
export function isLowStock(input: {
  status: 'active' | 'inactive';
  minQty: number;
  total: number;
}): boolean {
  return input.status === 'active' && input.minQty > 0 && input.total <= input.minQty;
}
