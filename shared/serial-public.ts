import type { SerialChangeDto } from './contract';
import type { SerialEventType, SerialStatus } from './serials';

/**
 * DTO halaman publik laporan rusak (tautan bertanda tangan, tanpa login; rancangan 2026-11-14 §4.8). Bukan bagian
 * `ApiContract` (rute publik dilayani sub-aplikasi `/api/public`, bukan `API_ROUTES`): hanya tipe, daftar putih field.
 * TANPA angka stok, alamat surel pengguna, atau `data` kejadian mentah.
 */
export interface SerialPublicEventDto {
  seq: number;
  type: SerialEventType;
  occurredOn: string;
  actorName: string;
  actorTeam: 'qc' | 'service' | 'system';
  /** Markdown; gambar `qcfile:` dilayani lewat rute berkas bertoken. */
  message: string;
  changes: SerialChangeDto[];
}

export interface SerialPublicReportDto {
  /** `LP-YYYYMMDD-NNN`. */
  number: string;
  openedOn: string;
  closedOn: string | null;
  outcome: 'good' | 'broken' | null;
  /** Tanggal terakhir tautan berlaku (`YYYY-MM-DD`, WIB). */
  expiresOn: string;
  /** Pemegang tautan sedang login dan berizin pada serial ini: UI mengarahkannya ke halaman biasa. */
  viewerCanOpen: boolean;
  serialId: string;
  unit: {
    serial: string;
    itemLabel: string;
    buCode: string;
    buName: string;
    locationName: string;
    testDate: string;
    sample: boolean;
    status: SerialStatus;
  };
  /** Kejadian dalam lingkup nomor LP ini saja (§5a), `seq` naik. */
  events: SerialPublicEventDto[];
}
