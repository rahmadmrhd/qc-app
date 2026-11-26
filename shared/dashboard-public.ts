/**
 * DTO halaman dashboard publik (spek dashboard 7.4 butir 4): daftar putih. Murni, tanpa API runtime/DOM.
 * `toPublicDto` adalah satu-satunya pintu keluaran widget ke publik: tanpa `previous` (tak ada delta), daftar
 * maks. `PUBLIC_LIST_ROW_MAX` baris, dan kolom hanya yang tercantum di `widgetMeta(id).listColumns`.
 */
import {
  type Bucket,
  type DashboardGroupId,
  type DashboardRange,
  type ListData,
  type NumberData,
  type PartsData,
  type SeriesData,
  type WidgetData,
  type WidgetId,
  widgetMeta,
} from './dashboard';

export const PUBLIC_LIST_ROW_MAX = 10;

/** Daftar publik: TANPA `total` (jumlah seluruh baris cakupan tak ikut keluar; keputusan pemilik 2026-11-24). */
export type PublicListData = Omit<ListData, 'total'>;

export type PublicWidgetData =
  | Omit<NumberData, 'previous'>
  | PartsData
  | SeriesData
  | PublicListData;

function publicList(id: WidgetId, data: ListData): PublicListData {
  const columns = (widgetMeta(id).listColumns ?? []).map(({ key, label }) => ({ key, label }));
  const rows = data.rows.slice(0, PUBLIC_LIST_ROW_MAX).map((row) => {
    const out: Record<string, string | number> = {};
    for (const column of columns) out[column.key] = row[column.key] ?? '';
    return out;
  });
  return { kind: 'list', columns, rows };
}

/** Memetakan hasil widget ke bentuk yang boleh keluar ke publik. */
export function toPublicDto(id: WidgetId, data: WidgetData): PublicWidgetData {
  switch (data.kind) {
    case 'number':
      return data.note === undefined
        ? { kind: 'number', value: data.value }
        : { kind: 'number', value: data.value, note: data.note };
    case 'list':
      return publicList(id, data);
    case 'parts':
      // Daftar putih eksplisit: properti lain yang kelak ditambahkan widget tidak ikut keluar ke publik. `key` irisan
      // diganti indeks karena dapat berisi id internal (lokasi, customer, item); klien hanya memakainya sebagai kunci.
      return {
        kind: 'parts',
        slices: data.slices.map((slice, index) => ({
          key: String(index),
          label: slice.label,
          value: slice.value,
        })),
      };
    case 'series':
      // `points[].key` = kunci bucket waktu (tanggal/minggu/bulan), bukan id internal: tetap. `series[].key` diganti
      // indeks seperti irisan.
      return {
        kind: 'series',
        bucket: data.bucket,
        points: data.points.map((point) => ({ key: point.key, label: point.label })),
        series: data.series.map((entry, index) => ({
          key: String(index),
          label: entry.label,
          values: [...entry.values],
        })),
      };
  }
}

export interface PublicFilterOption {
  value: string;
  label: string;
}

/** Pilihan filter yang boleh dipakai penonton: hanya nilai di dalam cakupan beku. */
export interface PublicFilterOptions {
  bu: PublicFilterOption[];
  location: PublicFilterOption[];
  /** Hanya kunci filter relasi yang ditawarkan pembagi (nilai = pilihan pembagi). */
  groups: Partial<Record<string, PublicFilterOption[]>>;
}

export interface PublicDashboardDto {
  title: string;
  /** Bagian lokal surel pembagi (`publicActorName`). */
  sharedBy: string;
  generatedAt: string;
  expiresAt: string;
  range: DashboardRange;
  /**
   * Rentang beku pembagi (sebelum penyempitan penonton; bergulir dihitung pada hari buka): batas kolom tanggal filter.
   * Sama dengan `range` pada tampilan bawaan.
   */
  bounds: DashboardRange;
  bucket: Bucket;
  /** Nama cakupan beku untuk kepala halaman; yang terhapus tetap bernama dan ditandai (`*Deleted[i]` ↔ `*Names[i]`). */
  scope: {
    buNames: string[];
    buDeleted: boolean[];
    locationNames: string[];
    locationDeleted: boolean[];
  };
  options: PublicFilterOptions;
  widgets: {
    id: WidgetId;
    group: DashboardGroupId;
    result: { status: 'ok'; data: PublicWidgetData } | { status: 'error'; message: string };
  }[];
}

/** Filter penonton (K1): hanya mempersempit; server menjepit dan mengiris ke cakupan beku. */
export interface PublicQueryInput {
  buIds?: string[];
  locationIds?: string[];
  from?: string;
  to?: string;
  groups?: Partial<Record<DashboardGroupId, Record<string, string[]>>>;
}

/** Baris daftar maksimum di surel laporan terjadwal (spek dashboard 7a.3). */
export const EMAIL_LIST_ROW_MAX = 5;

/**
 * Bentuk yang dipakai surel laporan terjadwal: DTO publik ditambah dua angka yang HANYA ada di surel (surel dikirim
 * ke penerima yang dipilih pemilik, bukan ke pemegang tautan): `previous` pada number (untuk delta periode lalu) dan
 * `total` pada daftar (untuk "Menampilkan N dari M"). Daftar dipotong `EMAIL_LIST_ROW_MAX` baris dan kolomnya hanya
 * `listColumns`.
 */
export type EmailWidgetData = NumberData | PartsData | SeriesData | ListData;

/** Memetakan hasil widget ke bentuk surel (daftar putih; pasangan `toPublicDto`). */
export function toEmailDto(id: WidgetId, data: WidgetData): EmailWidgetData {
  switch (data.kind) {
    case 'number':
      return {
        kind: 'number',
        value: data.value,
        ...(data.previous === undefined ? {} : { previous: data.previous }),
        ...(data.note === undefined ? {} : { note: data.note }),
      };
    case 'list': {
      const list = publicList(id, data);
      return {
        kind: 'list',
        columns: list.columns,
        rows: list.rows.slice(0, EMAIL_LIST_ROW_MAX),
        total: data.total,
      };
    }
    case 'parts':
    case 'series':
      // Irisan dan seri memakai pemetaan publik (indeks sebagai `key`, tanpa properti lain).
      return toPublicDto(id, data) as PartsData | SeriesData;
  }
}
