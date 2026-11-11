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
  /** Maksimum penerima email ringkasan stok menipis. */
  alertRecipientsMax: 20,
} as const;

/**
 * Pustaka gambar stiker (tahap 3b-1, spek 2026-11-10): satu sumber batas untuk server dan klien.
 * `thumbMaxBytes` = batas keras server; `thumbTargetBytes`/`thumbSide` = target kompresi klien.
 */
export const GUIDE_LIMITS = {
  /** Jumlah maksimum gambar pustaka (seluruh pengguna). */
  libraryMax: 2000,
  /** Panjang maksimum nama gambar (karakter). */
  nameMax: 120,
  /** Maksimum berkas per seretan unggah. */
  batchMax: 20,
  /** Ukuran halaman daftar bawaan dan maksimum. */
  pageDefault: 40,
  pageMax: 100,
  /** Ukuran thumbnail (byte): batas keras server, target klien, dan sisi terpanjang. */
  thumbMaxBytes: 40_960,
  thumbTargetBytes: 30_720,
  thumbSide: 320,
  thumbMaxSide: 400,
} as const;

/** Urutan daftar pustaka gambar (`usageDesc` = paling sering dipakai). */
export const GUIDE_SORTS = [
  'newest',
  'oldest',
  'nameAsc',
  'nameDesc',
  'sizeDesc',
  'usageDesc',
] as const;
export type GuideSort = (typeof GUIDE_SORTS)[number];

/**
 * Nama awal gambar pustaka dari nama berkas: ekstensi terakhir dibuang, spasi dirapikan, dipotong `nameMax`
 * karakter (titik kode, bukan unit UTF-16). Hasil kosong = "Gambar".
 */
export function guideNameFromFile(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot >= 0 ? filename.slice(0, dot) : filename;
  const collapsed = base.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return 'Gambar';
  return [...collapsed].slice(0, GUIDE_LIMITS.nameMax).join('').trim();
}

/** Status stiker (tahap 4a): `deprecated` = digantikan versi Manual Book yang lebih baru, hanya bisa menjadi `inactive`. */
export const STICKER_STATUSES = ['active', 'inactive', 'deprecated'] as const;
export type StickerStatus = (typeof STICKER_STATUSES)[number];

/** Jenis sistem (tahap 4a): `''` = jenis biasa; `manual_book` dan `postel` dikelola aplikasi, tak diubah lewat form. */
export const STICKER_SYSTEM_KINDS = ['', 'manual_book', 'postel'] as const;
export type StickerSystemKind = (typeof STICKER_SYSTEM_KINDS)[number];

/**
 * Aturan penentuan stiker yang berlaku bagi sebuah item. `group` (tahap 4a) = menurut kelompok item, ditentukan per
 * jenis sistem (Manual Book, Postel); hanya jenis sistem yang memakainya; pengguna tidak membuatnya lewat form (lihat `USER_STICKER_RULES`).
 */
export const STICKER_RULES = ['bu', 'none', 'group'] as const;
export type StickerRule = (typeof STICKER_RULES)[number];

/** Aturan yang boleh dipilih pengguna saat menyimpan jenis stiker (tanpa `group`). */
export const USER_STICKER_RULES = ['bu', 'none'] as const;

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

/** Menipis: stiker aktif (bukan `inactive`/`deprecated`), batas minimum > 0, dan total semua lokasi <= batas. */
export function isLowStock(input: {
  status: StickerStatus;
  minQty: number;
  total: number;
}): boolean {
  return input.status === 'active' && input.minQty > 0 && input.total <= input.minQty;
}

/**
 * Instruksi stiker per item (tahap 3b-2, spek 2026-11-10): batas foto, penanda, dan teks. Koordinat penanda
 * bilangan bulat permil (0..`coordMax`) dari lebar/tinggi foto.
 */
export const INSTRUCTION_LIMITS = {
  /** Foto instruksi per item (satu foto pustaka hanya sekali per item). */
  photos: 10,
  /** Penanda per foto. */
  marks: 30,
  /** Panjang maksimum catatan foto (karakter). */
  caption: 200,
  /** Panjang maksimum catatan penanda (karakter). */
  markNote: 120,
  /** Nilai koordinat maksimum (permil). */
  coordMax: 1000,
} as const;

/** Sasaran penanda: tepat satu, stiker tertentu atau jenis stiker (diterjemahkan menurut BU item). */
export type StickerMarkTarget =
  | { kind: 'sticker'; stickerId: string }
  | { kind: 'type'; typeId: string };

/** Bentuk minimum stiker untuk pencocokan jenis -> stiker. */
export interface MatchSticker {
  id: string;
  typeId: string;
  status: StickerStatus;
  buIds: readonly string[];
}

/** Bentuk minimum jenis stiker untuk pencocokan. */
export interface MatchType {
  id: string;
  rule: StickerRule;
}

/**
 * SATU definisi pencocokan jenis -> stiker bagi sebuah item: hanya stiker `active` berjenis itu (status jenis tidak
 * memengaruhi); aturan `none` = semuanya; aturan `bu` = yang tertaut ke minimal satu BU item (stiker tanpa BU tidak
 * pernah cocok); aturan `group` = yang `id`-nya ada di `groupStickerIds`, yang ditentukan pemanggil menurut
 * `system_kind` jenis (`manual_book` = stiker versi terbaru konfigurasi item; `postel` = stiker jenis itu bila item
 * tertaut ke catatan Postel yang ada). Urutan masukan dipertahankan.
 */
export function stickersForType(
  type: MatchType,
  stickers: readonly MatchSticker[],
  itemBuIds: readonly string[],
  groupStickerIds: ReadonlySet<string>,
): MatchSticker[] {
  const itemBus = new Set(itemBuIds);
  return stickers.filter((sticker) => {
    if (sticker.typeId !== type.id || sticker.status !== 'active') return false;
    if (type.rule === 'none') return true;
    if (type.rule === 'group') return groupStickerIds.has(sticker.id);
    return sticker.buIds.some((buId) => itemBus.has(buId));
  });
}
