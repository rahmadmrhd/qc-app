import type { Level, ModuleKey } from './permissions';
import {
  SERIAL_CUSTODIES,
  SERIAL_CUSTODY_LABELS,
  SERIAL_STATUS_LABELS,
  SERIAL_STATUSES,
} from './serials';

/** Grup widget di halaman Dashboard (urutan tampil). */
export const DASHBOARD_GROUPS = ['handover', 'serial', 'report', 'sticker'] as const;
export type DashboardGroupId = (typeof DASHBOARD_GROUPS)[number];

export const GROUP_LABELS: Record<DashboardGroupId, string> = {
  handover: 'Serah Terima',
  serial: 'Serial Number',
  report: 'Laporan rusak',
  sticker: 'Stok Stiker',
};

export const WIDGET_IDS = [
  'hs.created',
  'hs.active',
  'hs.avgDuration',
  'hs.trend',
  'hs.status',
  'hs.byLocation',
  'hs.byCustomer',
  'hs.oldest',
  'sn.total',
  'sn.avgMinutes',
  'sn.trend',
  'sn.status',
  'sn.byBu',
  'sn.byBrand',
  'sn.byItem',
  'sn.latest',
  'rp.open',
  'rp.opened',
  'rp.trend',
  'rp.result',
  'rp.oldest',
  'st.out',
  'st.low',
  'st.manualBook',
  'st.postel',
  'st.movement',
  'st.stickersByType',
  'st.stockBySticker',
  'st.attention',
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export type WidgetVisual =
  | 'number'
  | 'donut'
  | 'pie'
  | 'line'
  | 'bar'
  | 'barH'
  | 'barScroll'
  | 'barGroup'
  | 'list';

/** Arti: salah satu entri yang terpenuhi sudah cukup. */
export type WidgetAccess = readonly {
  module: ModuleKey;
  level: Level;
  scope: 'location' | 'bu' | 'global';
}[];

/** Arah perubahan yang dianggap baik untuk widget ber-delta. */
export type DeltaGood = 'up' | 'down';

export interface WidgetMeta {
  id: WidgetId;
  group: DashboardGroupId;
  visual: WidgetVisual;
  title: string;
  access: WidgetAccess;
  /** Filter BU global berlaku. */
  bu: boolean;
  /** Jenis lokasi yang dipakai filter Lokasi global; `none` = tidak berlaku. */
  location: 'handover' | 'stock' | 'serial' | 'none';
  /** `none` = kondisi saat ini (tak mengikuti tanggal); selain itu label kolom tanggal yang dipakai. */
  date: { kind: 'none' } | { kind: 'column'; label: string };
  /** Number card dengan perbandingan periode sebelumnya yang sama panjang. */
  delta: boolean;
  /**
   * Arah perubahan yang BAIK, wajib bila `delta` (keputusan pemilik 2026-11-23): warna perbandingan mengikutinya
   * (searah = hijau, berlawanan = merah), sedangkan panah dan teks selalu menurut naik/turun yang nyata.
   */
  deltaGood?: DeltaGood;
  listColumns?: readonly { key: string; label: string }[];
  /**
   * Letak di halaman (keputusan pemilik 2026-11-25): widget berurutan di grup yang sama dengan `row` yang sama tampil
   * sebagai SATU baris kisi, dan `span` = lebar kartu dari 12 kolom di layar lebar. Jenis berbeda TIDAK dicampur satu
   * baris (number card satu baris sendiri, grafik satu baris, daftar satu baris); satu-satunya pasangan sengaja adalah
   * Hasil penutupan + Laporan terbuka terlama.
   */
  row: string;
  span: number;
}

const HANDOVER_ACCESS: WidgetAccess = [
  { module: 'handover', level: 'view', scope: 'location' },
  { module: 'qc', level: 'edit', scope: 'location' },
];
const SERIAL_ACCESS: WidgetAccess = [
  { module: 'serial', level: 'view', scope: 'bu' },
  { module: 'serialservice', level: 'view', scope: 'bu' },
];
const STOCK_ACCESS: WidgetAccess = [{ module: 'stickerstock', level: 'view', scope: 'location' }];

const NO_DATE = { kind: 'none' } as const;
const dateColumn = (label: string) => ({ kind: 'column', label }) as const;

type Base = Pick<WidgetMeta, 'group' | 'access' | 'bu' | 'location'>;
const HANDOVER: Base = {
  group: 'handover',
  access: HANDOVER_ACCESS,
  bu: false,
  location: 'handover',
};
const SERIAL: Base = { group: 'serial', access: SERIAL_ACCESS, bu: true, location: 'serial' };
const REPORT: Base = { group: 'report', access: SERIAL_ACCESS, bu: true, location: 'serial' };
const STICKER: Base = { group: 'sticker', access: STOCK_ACCESS, bu: false, location: 'stock' };
/** Hitungan stiker (bukan stok): tak mengikuti filter Lokasi. */
const STICKER_CATALOG: Base = { ...STICKER, location: 'none' };

function widget(
  base: Base,
  id: WidgetId,
  visual: WidgetVisual,
  title: string,
  date: WidgetMeta['date'],
  layout: { row: string; span: number },
  extra: { delta?: DeltaGood; listColumns?: WidgetMeta['listColumns'] } = {},
): WidgetMeta {
  const meta: WidgetMeta = {
    ...base,
    id,
    visual,
    title,
    date,
    delta: extra.delta !== undefined,
    row: layout.row,
    span: layout.span,
  };
  if (extra.delta) meta.deltaGood = extra.delta;
  if (extra.listColumns) meta.listColumns = extra.listColumns;
  return meta;
}

/**
 * Urutan array = urutan tampil. Tiap grup: number card di bagian paling atas, lalu grafik, lalu daftar singkat.
 * Kolom `id` pada baris daftar (kunci tersembunyi) = id record untuk tautan di aplikasi; tidak pernah masuk DTO publik
 * atau surel (hanya `listColumns` yang disalin).
 */
export const WIDGETS: readonly WidgetMeta[] = [
  widget(
    HANDOVER,
    'hs.created',
    'number',
    'Task dibuat',
    dateColumn('Tanggal dibuat'),
    { row: 'numbers', span: 4 },
    { delta: 'up' },
  ),
  widget(HANDOVER, 'hs.active', 'number', 'Task aktif', NO_DATE, { row: 'numbers', span: 4 }),
  widget(
    HANDOVER,
    'hs.avgDuration',
    'number',
    'Rata-rata durasi selesai (jam)',
    dateColumn('Tanggal selesai'),
    { row: 'numbers', span: 4 },
  ),
  widget(HANDOVER, 'hs.trend', 'line', 'Jumlah task per periode', dateColumn('Tanggal dibuat'), {
    row: 'trend',
    span: 12,
  }),
  widget(HANDOVER, 'hs.status', 'donut', 'Komposisi status', dateColumn('Tanggal dibuat'), {
    row: 'breakdown',
    span: 4,
  }),
  widget(HANDOVER, 'hs.byLocation', 'donut', 'Task per lokasi', dateColumn('Tanggal dibuat'), {
    row: 'breakdown',
    span: 4,
  }),
  widget(HANDOVER, 'hs.byCustomer', 'barH', 'Customer teratas', dateColumn('Tanggal dibuat'), {
    row: 'breakdown',
    span: 4,
  }),
  widget(
    HANDOVER,
    'hs.oldest',
    'list',
    'Task aktif terlama',
    NO_DATE,
    { row: 'list', span: 12 },
    {
      listColumns: [
        { key: 'number', label: 'Nomor' },
        { key: 'customer', label: 'Customer' },
        { key: 'location', label: 'Lokasi' },
        { key: 'age', label: 'Lama berjalan (hari)' },
        { key: 'progress', label: 'Progres' },
      ],
    },
  ),

  widget(
    SERIAL,
    'sn.total',
    'number',
    'Total serial dicatat',
    dateColumn('Tanggal dicatat'),
    { row: 'numbers', span: 6 },
    { delta: 'up' },
  ),
  widget(
    SERIAL,
    'sn.avgMinutes',
    'number',
    'Rata-rata waktu per serial (menit)',
    dateColumn('Tanggal dicatat'),
    { row: 'numbers', span: 6 },
  ),
  widget(SERIAL, 'sn.trend', 'line', 'Dicatat per periode', dateColumn('Tanggal dicatat'), {
    row: 'trend',
    span: 12,
  }),
  widget(SERIAL, 'sn.status', 'donut', 'Komposisi status', dateColumn('Tanggal dicatat'), {
    row: 'breakdown',
    span: 6,
  }),
  widget(SERIAL, 'sn.byBu', 'donut', 'Serial per BU', dateColumn('Tanggal dicatat'), {
    row: 'breakdown',
    span: 6,
  }),
  widget(SERIAL, 'sn.byBrand', 'barH', 'Serial per brand', dateColumn('Tanggal dicatat'), {
    row: 'ranking',
    span: 6,
  }),
  widget(SERIAL, 'sn.byItem', 'barH', 'Item teratas', dateColumn('Tanggal dicatat'), {
    row: 'ranking',
    span: 6,
  }),
  widget(
    SERIAL,
    'sn.latest',
    'list',
    'Entri serial terakhir',
    dateColumn('Tanggal dicatat'),
    { row: 'list', span: 12 },
    {
      listColumns: [
        { key: 'item', label: 'Item' },
        { key: 'date', label: 'Tanggal' },
        { key: 'count', label: 'Jumlah' },
        { key: 'by', label: 'Dicatat oleh' },
      ],
    },
  ),

  widget(REPORT, 'rp.open', 'number', 'Laporan terbuka', NO_DATE, { row: 'numbers', span: 6 }),
  widget(
    REPORT,
    'rp.opened',
    'number',
    'Laporan dibuka',
    dateColumn('Tanggal dibuka'),
    { row: 'numbers', span: 6 },
    { delta: 'down' },
  ),
  widget(REPORT, 'rp.trend', 'line', 'Laporan dibuat per periode', dateColumn('Tanggal dibuka'), {
    row: 'trend',
    span: 12,
  }),
  widget(REPORT, 'rp.result', 'donut', 'Hasil penutupan', dateColumn('Tanggal ditutup'), {
    row: 'split',
    span: 5,
  }),
  widget(
    REPORT,
    'rp.oldest',
    'list',
    'Laporan terbuka terlama',
    NO_DATE,
    { row: 'split', span: 7 },
    {
      listColumns: [
        { key: 'number', label: 'Nomor' },
        { key: 'status', label: 'Status serial' },
        { key: 'location', label: 'Lokasi' },
        { key: 'days', label: 'Lama (hari)' },
      ],
    },
  ),

  widget(STICKER, 'st.out', 'number', 'Stok habis', NO_DATE, { row: 'numbers', span: 3 }),
  widget(STICKER, 'st.low', 'number', 'Stok menipis', NO_DATE, { row: 'numbers', span: 3 }),
  widget(STICKER_CATALOG, 'st.manualBook', 'number', 'Manual Book aktif', NO_DATE, {
    row: 'numbers',
    span: 3,
  }),
  widget(STICKER_CATALOG, 'st.postel', 'number', 'Postel aktif', NO_DATE, {
    row: 'numbers',
    span: 3,
  }),
  widget(
    STICKER,
    'st.movement',
    'barGroup',
    'Stok masuk dan keluar',
    dateColumn('Tanggal entri stok'),
    { row: 'charts', span: 6 },
  ),
  widget(STICKER_CATALOG, 'st.stickersByType', 'donut', 'Jumlah stiker per jenis', NO_DATE, {
    row: 'charts',
    span: 6,
  }),
  widget(STICKER, 'st.stockBySticker', 'barScroll', 'Total stok per stiker', NO_DATE, {
    row: 'stockAll',
    span: 12,
  }),
  widget(
    STICKER,
    'st.attention',
    'list',
    'Stok perlu perhatian',
    NO_DATE,
    { row: 'list', span: 12 },
    {
      listColumns: [
        { key: 'sticker', label: 'Stiker' },
        { key: 'type', label: 'Jenis' },
        { key: 'location', label: 'Lokasi' },
        { key: 'stock', label: 'Stok' },
        { key: 'min', label: 'Minimum' },
      ],
    },
  ),
];

const WIDGET_BY_ID: ReadonlyMap<WidgetId, WidgetMeta> = new Map(
  WIDGETS.map((meta) => [meta.id, meta]),
);

export function widgetMeta(id: WidgetId): WidgetMeta {
  const meta = WIDGET_BY_ID.get(id);
  if (!meta) throw new Error(`Widget dashboard tidak dikenal: ${id}`);
  return meta;
}

export interface GroupFilterField {
  key: string;
  label: string;
  kind: 'enum' | 'relation';
  options?: readonly { value: string; label: string }[];
  relation?: 'customer' | 'item' | 'brand' | 'stickerType' | 'sticker';
}

/** Kunci filter global; field filter grup TIDAK BOLEH memakainya. */
export const GLOBAL_FILTER_KEYS = ['bu', 'location', 'date'] as const;

export const GROUP_FILTERS: Record<DashboardGroupId, readonly GroupFilterField[]> = {
  handover: [
    { key: 'customer', label: 'Customer', kind: 'relation', relation: 'customer' },
    {
      key: 'status',
      label: 'Status papan',
      kind: 'enum',
      options: [
        { value: 'new', label: 'Baru' },
        { value: 'in_progress', label: 'Dikerjakan' },
        { value: 'done', label: 'Selesai' },
        { value: 'cancelled', label: 'Dibatalkan' },
      ],
    },
  ],
  serial: [
    {
      key: 'status',
      label: 'Status',
      kind: 'enum',
      options: SERIAL_STATUSES.map((value) => ({ value, label: SERIAL_STATUS_LABELS[value] })),
    },
    {
      key: 'custody',
      label: 'Kustodi',
      kind: 'enum',
      options: SERIAL_CUSTODIES.map((value) => ({ value, label: SERIAL_CUSTODY_LABELS[value] })),
    },
    { key: 'brand', label: 'Brand', kind: 'relation', relation: 'brand' },
    { key: 'item', label: 'Item', kind: 'relation', relation: 'item' },
  ],
  report: [
    {
      key: 'status',
      label: 'Status laporan',
      kind: 'enum',
      options: [
        { value: 'open', label: 'Terbuka' },
        { value: 'closed', label: 'Tertutup' },
      ],
    },
    {
      key: 'result',
      label: 'Hasil',
      kind: 'enum',
      options: [
        { value: 'broken', label: 'Rusak' },
        { value: 'good', label: 'Lolos' },
      ],
    },
  ],
  sticker: [
    { key: 'stickerType', label: 'Jenis stiker', kind: 'relation', relation: 'stickerType' },
    { key: 'sticker', label: 'Stiker', kind: 'relation', relation: 'sticker' },
  ],
};

/** Rentang hari WIB, `YYYY-MM-DD`, inklusif di kedua ujung. */
export interface DashboardRange {
  from: string;
  to: string;
}
export const DASHBOARD_RANGE_MAX_DAYS = 366;
export type Bucket = 'day' | 'week' | 'month';

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Epoch ms tengah malam UTC untuk tanggal kalender sah, selain itu `null`. */
function dateMs(value: string): number | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function rangeDays(range: DashboardRange): number {
  const from = dateMs(range.from);
  const to = dateMs(range.to);
  if (from === null || to === null) throw new Error('Rentang tanggal tidak sah');
  return Math.round((to - from) / DAY_MS) + 1;
}

export function validateDashboardRange(range: DashboardRange): string | null {
  const from = dateMs(range.from);
  const to = dateMs(range.to);
  if (from === null || to === null) return 'Tanggal tidak sah';
  if (from > to) return 'Tanggal awal tidak boleh setelah tanggal akhir';
  if (rangeDays(range) > DASHBOARD_RANGE_MAX_DAYS) {
    return `Rentang tanggal maksimal ${DASHBOARD_RANGE_MAX_DAYS} hari`;
  }
  return null;
}

export function bucketFor(range: DashboardRange): Bucket {
  const days = rangeDays(range);
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

/** Batas UTC untuk hari-hari WIB penuh; `toIso` eksklusif. */
export function wibRangeToUtc(range: DashboardRange): { fromIso: string; toIso: string } {
  const from = dateMs(range.from);
  const to = dateMs(range.to);
  if (from === null || to === null) throw new Error('Rentang tanggal tidak sah');
  return {
    fromIso: new Date(from - WIB_OFFSET_MS).toISOString(),
    toIso: new Date(to + DAY_MS - WIB_OFFSET_MS).toISOString(),
  };
}

/** Periode tepat sebelum `range` dengan panjang hari yang sama. */
export function previousRange(range: DashboardRange): DashboardRange {
  const from = dateMs(range.from);
  if (from === null) throw new Error('Rentang tanggal tidak sah');
  const days = rangeDays(range);
  const to = from - DAY_MS;
  return { from: formatDate(to - (days - 1) * DAY_MS), to: formatDate(to) };
}

export type RangePreset = 'last7' | 'last30' | 'thisMonth' | 'lastMonth';

export function rangePreset(preset: RangePreset, todayWib: string): DashboardRange {
  const today = dateMs(todayWib);
  if (today === null) throw new Error('Tanggal tidak sah');
  switch (preset) {
    case 'last7':
      return { from: formatDate(today - 6 * DAY_MS), to: todayWib };
    case 'last30':
      return { from: formatDate(today - 29 * DAY_MS), to: todayWib };
    case 'thisMonth': {
      const now = new Date(today);
      return {
        from: formatDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: todayWib,
      };
    }
    case 'lastMonth': {
      const now = new Date(today);
      const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
      const last = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0);
      return { from: formatDate(first), to: formatDate(last) };
    }
  }
}

export interface NumberData {
  kind: 'number';
  value: number;
  previous?: number;
}
export interface PartsData {
  kind: 'parts';
  slices: { key: string; label: string; value: number }[];
}
export interface SeriesData {
  kind: 'series';
  bucket: Bucket;
  points: { key: string; label: string }[];
  series: { key: string; label: string; values: number[] }[];
}
export interface ListData {
  kind: 'list';
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
  total: number;
}
export type WidgetData = NumberData | PartsData | SeriesData | ListData;

export type WidgetResult =
  | { id: WidgetId; status: 'ok'; data: WidgetData }
  | { id: WidgetId; status: 'error'; message: string };

export interface DashboardFilterInput {
  buIds?: string[];
  locationIds?: string[];
  from: string;
  to: string;
}
export interface DashboardWidgetRequest {
  id: WidgetId;
  filters?: Record<string, string[]>;
}
export interface DashboardQueryInput {
  filter: DashboardFilterInput;
  widgets: DashboardWidgetRequest[];
}
export interface DashboardQueryOutput {
  generatedAt: string;
  range: DashboardRange;
  bucket: Bucket;
  widgets: WidgetResult[];
}
export interface DashboardOption {
  value: string;
  label: string;
}
export interface DashboardOptionsDto {
  customers: DashboardOption[];
  items: DashboardOption[];
  brands: DashboardOption[];
  stickerTypes: DashboardOption[];
  stickers: DashboardOption[];
  /** Kursor halaman berikutnya per daftar; hanya ada untuk daftar yang masih punya sisa. */
  next?: Partial<Record<DashboardOptionKind, string>>;
}

/** Daftar pilihan relasi untuk filter grup. */
export const DASHBOARD_OPTION_KINDS = [
  'customers',
  'items',
  'brands',
  'stickerTypes',
  'stickers',
] as const;
export type DashboardOptionKind = (typeof DASHBOARD_OPTION_KINDS)[number];

/** Batas halaman pilihan filter relasi (keputusan pemilik 2026-11-23: pencarian di server, bukan potong 500). */
export const OPTIONS_PAGE_DEFAULT = 50;
export const OPTIONS_PAGE_MAX = 100;
/** Maks. id yang diresolusi sekaligus (nilai terpilih/URL), dan panjang maks. kata pencarian. */
export const OPTIONS_IDS_MAX = 20;
export const OPTIONS_QUERY_MAX = 100;

/**
 * Masukan opsional `dashboard.options` (aditif). Tanpa `kind` = keempat daftar, halaman pertama masing-masing.
 * `query`, `cursor`, dan `ids` WAJIB bersama `kind`. `cursor` = kursor `next` dari halaman sebelumnya. `ids`
 * meresolusi nama nilai terpilih (mengabaikan `query`/`cursor`/`limit`; yang tak ada atau di luar hak tidak
 * dikembalikan).
 */
export interface DashboardOptionsInput {
  kind?: DashboardOptionKind;
  query?: string;
  cursor?: string;
  limit?: number;
  ids?: string[];
}
