/**
 * Kontrak tautan dashboard publik (spek dashboard bagian 7): batas, cakupan beku yang disimpan di
 * `dashboard_shares.scope`, DTO daftar tautan, dan masukan pembuatan. Murni, tanpa API runtime/DOM.
 */
import type { DashboardFilterInput, WidgetId } from './dashboard';
import type { ShareVisitDto } from './dashboard-visit';
import { wibDateIso } from './postel';
import { isIsoDate } from './serials';

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;

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

/** Cakupan beku untuk halaman View tautan: BU dan lokasi dengan NAMA (bukan id), filter grup mentah + nama nilai relasi. */
export interface ShareScopeDetailDto {
  /** Nama BU beku, termasuk yang sudah dihapus; `buDeleted[i]` menandai `buNames[i]` terhapus (kit: penanda Terhapus). */
  buNames: string[];
  buDeleted: boolean[];
  locationNames: string[];
  locationDeleted: boolean[];
  locationFiltered: boolean;
  range: ShareRange;
  /** Widget beserta filter grupnya (nilai mentah: id relasi atau nilai enum). */
  widgets: ShareWidgetScope[];
  /**
   * Nama nilai filter relasi (id -> nama) yang dapat diresolusi lewat hak PEMANGGIL; id tanpa nama (di luar hak atau
   * sudah terhapus) tidak ada di peta dan ditampilkan sebagai nilai tak dikenal.
   */
  valueNames: Record<string, string>;
  /** Kunci filter relasi yang ditawarkan ke penonton. */
  offers: string[];
}

/** Detail satu tautan untuk halaman View: daftar tautan + dicabut oleh, cakupan, ringkasan dan daftar kunjungan. */
export interface DashboardShareDetailDto extends DashboardShareDto {
  /** Surel pencabut; kosong = belum dicabut. */
  revokedBy: string;
  /** Jumlah SEMUA kunjungan (baris yang tersimpan hanya `visits`, maks. 50 terbaru). */
  visitCount: number;
  firstVisitAt: string;
  lastVisitAt: string;
  visits: ShareVisitDto[];
  scope: ShareScopeDetailDto;
}

export interface CreateShareInput {
  title: string;
  filter: DashboardFilterInput;
  locationFiltered?: boolean;
  range: ShareRange;
  widgets: ShareWidgetScope[];
  offers: string[];
  /** Masa berlaku dalam hari (1-365) dari saat dibuat. Tepat SATU dari `expiresInDays` dan `expiresOn` wajib ada. */
  expiresInDays?: number;
  /**
   * Berlaku sampai akhir hari ini (`YYYY-MM-DD`, WIB, 23:59:59.999), sejak hari ini sampai maks. 365 hari ke depan.
   * Dipakai pilihan "Tanggal tertentu"; server yang menyetel jam akhir hari (bukan jam pembuatan).
   */
  expiresOn?: string;
}

/** Epoch ms akhir hari WIB (23:59:59.999) pada `day` (`YYYY-MM-DD`); `NaN` bila bukan tanggal sah. */
export function endOfWibDayMs(day: string): number {
  if (!isIsoDate(day)) return Number.NaN;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date, 23, 59, 59, 999) - WIB_OFFSET_MS;
}

/**
 * Waktu kedaluwarsa tautan (epoch ms) dari masukan: `expiresOn` = akhir hari WIB itu, `expiresInDays` = sekarang + N x
 * 24 jam. Mengembalikan teks masalah (untuk field `expiresInDays`/`expiresOn`) bila tidak sah: tepat satu dari kedua
 * field wajib ada, hari 1-`expiryDaysMax`, tanggal antara hari ini dan hari ini + `expiryDaysMax` hari (WIB).
 */
export function shareExpiry(
  input: Pick<CreateShareInput, 'expiresInDays' | 'expiresOn'>,
  nowMs: number,
): { ok: true; ms: number } | { ok: false; field: 'expiresInDays' | 'expiresOn'; message: string } {
  const hasDays = input.expiresInDays !== undefined;
  const hasDate = input.expiresOn !== undefined;
  if (hasDays === hasDate) {
    return {
      ok: false,
      field: hasDays ? 'expiresOn' : 'expiresInDays',
      message: 'Isi tepat satu: masa berlaku (hari) atau tanggal berlaku',
    };
  }
  if (hasDate) {
    const day = String(input.expiresOn);
    const end = endOfWibDayMs(day);
    const today = wibDateIso(nowMs);
    const latest = endOfWibDayMs(wibDateIso(nowMs + SHARE_LIMITS.expiryDaysMax * DAY_MS));
    if (Number.isNaN(end) || day < today || end > latest) {
      return {
        ok: false,
        field: 'expiresOn',
        message: `Tanggal berlaku harus dari hari ini sampai ${SHARE_LIMITS.expiryDaysMax} hari ke depan`,
      };
    }
    return { ok: true, ms: end };
  }
  const days = input.expiresInDays;
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > SHARE_LIMITS.expiryDaysMax
  ) {
    return {
      ok: false,
      field: 'expiresInDays',
      message: `Masa berlaku harus 1-${SHARE_LIMITS.expiryDaysMax} hari`,
    };
  }
  return { ok: true, ms: nowMs + days * DAY_MS };
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
