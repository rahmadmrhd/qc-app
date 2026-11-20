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
  /** Interval kirim ringkasan stok menipis terpanjang (hari); 1 = tiap hari. */
  alertIntervalDaysMax: 365,
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
 * Awalan nama stiker jenis sistem di katalog (keputusan pemilik 2026-11-12): agar stiker Manual Book dan Postel tak
 * tertukar dengan stiker lain. Awalan Manual Book dipersingkat dari `Manual Book - ` menjadi `MB - ` (keputusan pemilik
 * 2026-11-20; stiker yang sudah ada tidak diganti namanya, hanya stiker baru yang memakai awalan ini). Nama TERSIMPAN berawalan ini (bukan hanya tampilan), jadi muncul sama di katalog, stok,
 * riwayat, instruksi item, dan email.
 */
export const SYSTEM_STICKER_PREFIX = {
  manual_book: 'MB - ',
  postel: 'Postel - ',
} as const;

/** Nama stiker Manual Book `MB - <nama konfigurasi> v<versi>`, dipotong ke `nameMax`. */
export function manualBookStickerName(designName: string, version: number): string {
  return `${SYSTEM_STICKER_PREFIX.manual_book}${designName} v${version}`.slice(
    0,
    STICKER_LIMITS.nameMax,
  );
}

/**
 * Nama stiker Postel `Postel - <nama Postel>` ditambah `suffix` (pembeda bila namanya bentrok dengan stiker Postel
 * lain). Bagian nama dipotong lebih dulu agar `suffix` selalu utuh dan totalnya <= `nameMax`.
 */
export function postelStickerName(postelName: string, suffix = ''): string {
  return (
    `${SYSTEM_STICKER_PREFIX.postel}${postelName}`.slice(
      0,
      STICKER_LIMITS.nameMax - suffix.length,
    ) + suffix
  );
}

/**
 * Aturan penentuan stiker yang berlaku bagi sebuah item. `group` (tahap 4a) = menurut kelompok item, ditentukan per
 * jenis sistem (Manual Book, Postel); hanya jenis sistem yang memakainya; pengguna tidak membuatnya lewat form (lihat `USER_STICKER_RULES`).
 */
export const STICKER_RULES = ['bu', 'none', 'group'] as const;
export type StickerRule = (typeof STICKER_RULES)[number];

/** Aturan yang boleh dipilih pengguna saat menyimpan jenis stiker (tanpa `group`). */
export const USER_STICKER_RULES = ['bu', 'none'] as const;

/** Jenis entri riwayat stok; `serial` = pemotongan otomatis oleh pencatatan Serial Number (boleh membuat stok negatif). */
export const STOCK_ENTRY_KINDS = ['in', 'out', 'adjust', 'opname', 'serial'] as const;
export type StockEntryKind = (typeof STOCK_ENTRY_KINDS)[number];

/** Stok untuk tampilan: negatif (akibat pemotongan Serial Number) ditulis "Kurang N". */
export function formatStockQty(qty: number): string {
  return qty < 0 ? `Kurang ${-qty}` : String(qty);
}

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

/** Habis: stiker aktif dengan total semua lokasi <= 0 (termasuk negatif), apa pun nilai minimumnya. */
export function isOutOfStock(input: { status: StickerStatus; total: number }): boolean {
  return input.status === 'active' && input.total <= 0;
}

/**
 * Bagian pada ringkasan harian stok: "Habis" (`isOutOfStock`) lebih dulu, lalu "Menipis" (`isLowStock`) untuk yang
 * belum habis; stiker yang habis TIDAK diulang di bagian menipis. `null` = tidak masuk ringkasan. Definisi `low` pada
 * halaman Stok (`isLowStock`) tidak berubah.
 */
export function stockDigestSection(input: {
  status: StickerStatus;
  minQty: number;
  total: number;
}): 'out' | 'low' | null {
  if (isOutOfStock(input)) return 'out';
  return isLowStock(input) ? 'low' : null;
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
