/** Kontrak sinkronisasi QC Desktop (docs/api/desktop-sync.md). Murni: tanpa API GAS/DOM. */
/** Versi kontrak amplop RPC lama (khusus aplikasi Apps Script `gas/`, sampai dipensiunkan di T35). */
export const SYNC_API_VERSION = 1;
/** Versi API kontrak REST QC Desktop (`/api/v1/sync/*`, Task 25; keputusan pemilik 2026-11-06). */
export const SYNC_REST_API_VERSION = 2;
/** Pelaku yang tercatat di audit untuk semua perubahan lewat jalur sinkron. */
export const SYNC_ACTOR = 'sync:desktop';
export const SYNC_TOKEN_MIN_LENGTH = 32;
export const SYNC_RESOURCES = ['brands', 'items'] as const;
export type SyncResource = (typeof SYNC_RESOURCES)[number];

export const SYNC_LIMITS = {
  /** Panjang maksimum body permintaan (karakter). */
  bodyChars: 5_000_000,
  pullDefault: 100,
  pullMax: 500,
  pullMaxWithDetail: 200,
  pushMax: 50,
  pushMaxWithDetail: 25,
  /** Ukuran maksimum berkas untuk `sync.file.get` dan pendaftaran otomatis (byte). */
  fileBytes: 8_000_000,
  /** Id Drive berbeda per entri item (galeri + stiker + Markdown): membatasi panggilan Drive per permintaan. */
  driveRefsPerEntry: 50,
  failedAttempts: 10,
  blockSeconds: 600,
} as const;

/** Perbandingan teks waktu-konstan terhadap isi (panjang berbeda tetap menelusuri panjang maksimum). */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** `error` = galat server sementara (lock, kuota, layanan Google): entri BELUM diproses dan boleh diulang; beda dari `invalid`. */
export type SyncResultStatus =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'conflict'
  | 'invalid'
  | 'error';

export interface SyncWireSticker {
  name: string;
  note: string;
  /** Id berkas Drive, atau `null`. */
  image: string | null;
}

export interface SyncWireItem {
  uid: string;
  /** Id MySQL; `null` bila belum terpetakan. */
  id: string | null;
  merk: string;
  tipe: string;
  isCountryLock: boolean;
  /** Id Drive, urut galeri. */
  images: string[];
  detail?: string;
  stickers?: SyncWireSticker[];
  accessories?: Array<{ name: string; qty: number }>;
  active: boolean;
  rev: number;
}

export interface SyncWireBrand {
  uid: string;
  id: string | null;
  name: string;
  active: boolean;
  rev: number;
}

export interface SyncEntryResult<T> {
  index: number;
  status: SyncResultStatus;
  uid?: string;
  rev?: number;
  /** Hanya pada `conflict`: nilai terkini di QC App. */
  current?: T;
  /** Hanya pada `invalid`: pesan per field. */
  fields?: Record<string, string>;
}

export interface SyncPullPage<T> {
  nextRev: number;
  hasMore: boolean;
  items?: T[];
  brands?: T[];
}
