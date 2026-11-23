import type { Level, ModuleKey } from './permissions';
import {
  SERIAL_CUSTODIES,
  SERIAL_CUSTODY_LABELS,
  SERIAL_STATUS_LABELS,
  SERIAL_STATUSES,
} from './serials';

/** Grup widget di halaman Dashboard (urutan tampil). */
export const DASHBOARD_GROUPS = ['handover', 'serial', 'report', 'sticker', 'postel'] as const;
export type DashboardGroupId = (typeof DASHBOARD_GROUPS)[number];

export const GROUP_LABELS: Record<DashboardGroupId, string> = {
  handover: 'Serah Terima',
  serial: 'Serial Number',
  report: 'Laporan rusak',
  sticker: 'Stok Stiker',
  postel: 'Postel',
};

export const WIDGET_IDS = [
  'hs.created',
  'hs.active',
  'hs.status',
  'hs.trend',
  'hs.byLocation',
  'hs.byCustomer',
  'hs.avgDuration',
  'hs.oldest',
  'sn.recorded',
  'sn.status',
  'sn.trend',
  'sn.byItem',
  'sn.byBu',
  'sn.custody',
  'sn.transit',
  'rp.open',
  'rp.opened',
  'rp.trend',
  'rp.result',
  'rp.oldest',
  'st.out',
  'st.low',
  'st.attention',
  'st.movement',
  'st.byType',
  'pt.condition',
  'pt.expiring',
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export type WidgetVisual =
  | 'number'
  | 'donut'
  | 'pie'
  | 'line'
  | 'bar'
  | 'barH'
  | 'barGroup'
  | 'list';

/** Arti: salah satu entri yang terpenuhi sudah cukup. */
export type WidgetAccess = readonly {
  module: ModuleKey;
  level: Level;
  scope: 'location' | 'bu' | 'global';
}[];

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
  listColumns?: readonly { key: string; label: string }[];
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
const POSTEL_ACCESS: WidgetAccess = [{ module: 'sticker', level: 'view', scope: 'global' }];

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
const POSTEL: Base = { group: 'postel', access: POSTEL_ACCESS, bu: false, location: 'none' };

function widget(
  base: Base,
  id: WidgetId,
  visual: WidgetVisual,
  title: string,
  date: WidgetMeta['date'],
  extra: { delta?: boolean; listColumns?: WidgetMeta['listColumns'] } = {},
): WidgetMeta {
  const meta: WidgetMeta = { ...base, id, visual, title, date, delta: extra.delta ?? false };
  if (extra.listColumns) meta.listColumns = extra.listColumns;
  return meta;
}

export const WIDGETS: readonly WidgetMeta[] = [
  widget(HANDOVER, 'hs.created', 'number', 'Task dibuat', dateColumn('Tanggal dibuat'), {
    delta: true,
  }),
  widget(HANDOVER, 'hs.active', 'number', 'Task aktif', NO_DATE),
  widget(HANDOVER, 'hs.status', 'donut', 'Komposisi status', dateColumn('Tanggal dibuat')),
  widget(
    HANDOVER,
    'hs.trend',
    'line',
    'Dibuat dan selesai',
    dateColumn('Tanggal dibuat dan selesai'),
  ),
  widget(HANDOVER, 'hs.byLocation', 'bar', 'Task per lokasi', dateColumn('Tanggal dibuat')),
  widget(HANDOVER, 'hs.byCustomer', 'barH', 'Customer teratas', dateColumn('Tanggal dibuat')),
  widget(
    HANDOVER,
    'hs.avgDuration',
    'number',
    'Rata-rata durasi selesai',
    dateColumn('Tanggal selesai'),
  ),
  widget(HANDOVER, 'hs.oldest', 'list', 'Task aktif terlama', NO_DATE, {
    listColumns: [
      { key: 'number', label: 'Nomor' },
      { key: 'customer', label: 'Customer' },
      { key: 'location', label: 'Lokasi' },
      { key: 'age', label: 'Umur' },
      { key: 'progress', label: 'Progres' },
    ],
  }),

  widget(SERIAL, 'sn.recorded', 'number', 'Serial dicatat', dateColumn('Tanggal dicatat'), {
    delta: true,
  }),
  widget(SERIAL, 'sn.status', 'donut', 'Komposisi status', dateColumn('Tanggal dicatat')),
  widget(SERIAL, 'sn.trend', 'line', 'Dicatat per periode', dateColumn('Tanggal dicatat')),
  widget(SERIAL, 'sn.byItem', 'barH', 'Item teratas', dateColumn('Tanggal dicatat')),
  widget(SERIAL, 'sn.byBu', 'bar', 'Serial per BU', dateColumn('Tanggal dicatat')),
  widget(SERIAL, 'sn.custody', 'pie', 'Posisi serial', dateColumn('Tanggal dicatat')),
  widget(SERIAL, 'sn.transit', 'list', 'Sedang dalam pengiriman', NO_DATE, {
    listColumns: [
      { key: 'serial', label: 'Serial Number' },
      { key: 'item', label: 'Item' },
      { key: 'route', label: 'Dari → ke' },
      { key: 'days', label: 'Lama (hari)' },
    ],
  }),

  widget(REPORT, 'rp.open', 'number', 'Laporan terbuka', NO_DATE),
  widget(REPORT, 'rp.opened', 'number', 'Laporan dibuka', dateColumn('Tanggal dibuka'), {
    delta: true,
  }),
  widget(
    REPORT,
    'rp.trend',
    'line',
    'Dibuka dan ditutup',
    dateColumn('Tanggal dibuka dan ditutup'),
  ),
  widget(REPORT, 'rp.result', 'donut', 'Hasil penutupan', dateColumn('Tanggal ditutup')),
  widget(REPORT, 'rp.oldest', 'list', 'Laporan terbuka terlama', NO_DATE, {
    listColumns: [
      { key: 'number', label: 'Nomor' },
      { key: 'status', label: 'Status serial' },
      { key: 'location', label: 'Lokasi' },
      { key: 'days', label: 'Lama (hari)' },
    ],
  }),

  widget(STICKER, 'st.out', 'number', 'Stok habis', NO_DATE),
  widget(STICKER, 'st.low', 'number', 'Stok menipis', NO_DATE),
  widget(STICKER, 'st.attention', 'list', 'Stok perlu perhatian', NO_DATE, {
    listColumns: [
      { key: 'sticker', label: 'Stiker' },
      { key: 'type', label: 'Jenis' },
      { key: 'location', label: 'Lokasi' },
      { key: 'stock', label: 'Stok' },
      { key: 'min', label: 'Minimum' },
    ],
  }),
  widget(
    STICKER,
    'st.movement',
    'barGroup',
    'Stok masuk dan keluar',
    dateColumn('Tanggal entri stok'),
  ),
  widget(STICKER, 'st.byType', 'bar', 'Total stok per jenis', NO_DATE),

  widget(POSTEL, 'pt.condition', 'donut', 'Kondisi Postel', NO_DATE),
  widget(POSTEL, 'pt.expiring', 'list', 'Postel segera habis atau kedaluwarsa', NO_DATE, {
    listColumns: [
      { key: 'name', label: 'Postel' },
      { key: 'number', label: 'Nomor aktif' },
      { key: 'expires', label: 'Tanggal habis' },
      { key: 'days', label: 'Sisa hari' },
    ],
  }),
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
  relation?: 'customer' | 'item' | 'stickerType' | 'sticker';
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
  postel: [
    {
      key: 'condition',
      label: 'Kondisi',
      kind: 'enum',
      options: [
        { value: 'valid', label: 'Berlaku' },
        { value: 'soon', label: 'Segera habis' },
        { value: 'expired', label: 'Kedaluwarsa' },
      ],
    },
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
  stickerTypes: DashboardOption[];
  stickers: DashboardOption[];
}
