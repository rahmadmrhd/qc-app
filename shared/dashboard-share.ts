/**
 * Kontrak tautan dashboard publik (spek dashboard bagian 7): batas, cakupan beku yang disimpan di
 * `dashboard_shares.scope`, DTO daftar tautan, dan masukan pembuatan. Murni, tanpa API runtime/DOM.
 */
import type { DashboardFilterInput, WidgetId } from './dashboard';

export const SHARE_LIMITS = {
  /** Jumlah widget maksimum dalam satu tautan. */
  widgetsMax: 30,
  /** Tautan aktif per pembagi (tautan terbitan laporan terjadwal tidak dihitung). */
  activePerSharer: 50,
  /** Plafon masa berlaku (K4). */
  expiryDaysMax: 365,
  expiryDaysDefault: 30,
  titleMax: 120,
} as const;

/** Kunci filter relasi yang dapat ditawarkan ke penonton (nilai pilihan pembagi menjadi batasnya). */
export const SHARE_OFFER_KEYS = ['customer', 'item', 'stickerType', 'sticker'] as const;

/** Rentang tanggal beku: tetap (`from`/`to` hari WIB, inklusif) atau bergulir (N hari terakhir, berakhir hari ini). */
export type ShareRange =
  | { mode: 'fixed'; from: string; to: string }
  | { mode: 'rolling'; days: number };

/** Widget dalam tautan beserta filter grup yang ikut beku. */
export interface ShareWidgetScope {
  id: WidgetId;
  filters: Record<string, string[]>;
}

/** Cakupan beku saat dibagikan (JSON di kolom `scope`). */
export interface ShareScope {
  /** Himpunan eksplisit hasil resolusi saat membagikan; kosong bukan berarti "semua". */
  buIds: string[];
  locationIds: string[];
  /** Serial/Laporan hanya memakai Lokasi sebagai filter bila `true`. */
  locationFiltered: boolean;
  range: ShareRange;
  widgets: ShareWidgetScope[];
  /** Kunci filter relasi yang ditawarkan ke penonton (subset `customer|item|stickerType|sticker`). */
  offers: string[];
}

export type ShareStatus = 'active' | 'expired' | 'revoked';

export interface DashboardShareDto {
  id: string;
  title: string;
  /** Surel pembagi. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  /** Kosong = belum dicabut. */
  revokedAt: string;
  status: ShareStatus;
  widgetCount: number;
  /** Terisi bila tautan diterbitkan laporan terjadwal (bukan dibagikan manual). */
  reportId: string;
  /** Hanya untuk pembagi atau super admin. */
  url?: string;
}

export interface CreateShareInput {
  title: string;
  filter: DashboardFilterInput;
  locationFiltered?: boolean;
  range: ShareRange;
  widgets: ShareWidgetScope[];
  offers: string[];
  expiresInDays: number;
}

/** Status tautan pada `nowIso`: dicabut menang atas kedaluwarsa; `expires_at <= now` = kedaluwarsa. */
export function shareStatus(
  row: { expires_at: string; revoked_at: string },
  nowIso: string,
): ShareStatus {
  if (row.revoked_at !== '') return 'revoked';
  if (row.expires_at <= nowIso) return 'expired';
  return 'active';
}
