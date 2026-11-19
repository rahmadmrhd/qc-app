// Kontrak jembatan renderer <-> proses utama (spek §6): tipe `QcBridge`, DTO, dan skema zod yang
// dipakai proses utama untuk memvalidasi SETIAP argumen IPC. Renderer tidak tepercaya: semua
// string dibatasi panjangnya, host harus sah, dan karakter kontrol ditolak.

import { z } from 'zod';
import type { DesktopCatalogDto } from '../../shared/desktop-catalog';
import {
  type BRIDGE_CHANNELS,
  DRAFT_MAX_BYTES,
  DRAFT_MAX_ROWS,
  MULTI_ACK_MAX,
} from './bridge-channels';
import type { CountryLockConfig } from './config';
import type { DeviceInfo } from './device-info';
import { isValidHost } from './host';
import type { PingKind } from './inject-plan';
import type { MultiStartConfig } from './multi/engine';
import { isIpv4, normalizeMac } from './multi/lease';
import type { MultiSnapshot } from './multi/snapshot';
import type { InjectedEvent } from './multi/types';
import type { AddResult, PendingEntry } from './pending';
import type { Brand } from './script-template';

export {
  AUTH_CHANGE_EVENT,
  BRIDGE_CHANNELS,
  BRIDGE_VERSION,
  CATALOG_BRIDGE_VERSION,
  CATALOG_CHANGE_EVENT,
  CATALOG_FILES_PATH,
  DRAFT_BRIDGE_VERSION,
  DRAFT_MAX_BYTES,
  DRAFT_MAX_ROWS,
  INJECT_PROGRESS_EVENT,
  MIN_BRIDGE_VERSION,
  MULTI_ACK_MAX,
  MULTI_BRIDGE_VERSION,
  MULTI_CHANGE_EVENT,
  NOTIFICATIONS_BRIDGE_VERSION,
  NOTIFICATIONS_CHANGE_EVENT,
  PENDING_TARGET_BRIDGE_VERSION,
  PENDING_UPLOAD_BRIDGE_VERSION,
  UI_UPDATE_READY_EVENT,
} from './bridge-channels';

export type { MultiDeviceDto, MultiSnapshot } from './multi/snapshot';
export type { InjectedEvent, MultiTarget } from './multi/types';

// --- Tipe kontrak -------------------------------------------------------------------------

export interface PingResult {
  ok: boolean;
  kind: PingKind;
}

export interface DeviceRequest {
  brand: Brand;
  host: string;
  username: string;
  password: string;
}

export interface InjectRequest {
  id: string;
  brand: Brand;
  firmwareCode: string;
  target: { ip: string; username: string; password: string };
}

export interface InjectResult {
  ok: boolean;
  stage: 'completed' | 'failed' | 'cancelled';
  message: string;
}

export interface InjectProgressDto {
  stage: 'connecting' | 'sending' | 'running' | 'completed' | 'failed' | 'cancelled';
  message: string;
}

/** Paket skrip untuk renderer: isi skrip TIDAK dikirim, kata sandi server dikosongkan. */
export interface PackageDto {
  dir: string;
  config: CountryLockConfig;
  missing: string[];
  warnings: string[];
}

export type DeviceInfoResult =
  | { ok: true; info: DeviceInfo }
  | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' };

export type RouterInfoResult =
  | { ok: true; serial: string; model: string }
  | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' };

/** Status login desktop untuk renderer: TIDAK pernah memuat token. */
export interface AuthStatus {
  signedIn: boolean;
  email: string | null;
  serverUrl: string;
}

/** Pemberitahuan bundel UI baru siap diterapkan (tanpa isi bundel). */
export interface UiUpdateInfo {
  uiVersion: string;
}

/** Status sinkronisasi katalog Tipe offline (tanpa token atau detail server). */
export interface CatalogStatus {
  /** `disabled` = build tanpa token katalog (Country Lock tetap jalan, Tipe dipilih manual). */
  state: 'disabled' | 'idle' | 'syncing' | 'ok' | 'error';
  itemCount: number;
  /** Kapan katalog tersimpan terakhir disinkronkan (ISO), atau `null` bila belum pernah. */
  syncedAt: string | null;
  /** Galat sinkron terakhir: server tak terjangkau, atau ditolak (token salah / rute dinonaktifkan). */
  error: 'UNAVAILABLE' | 'REJECTED' | null;
}

/** Katalog tersimpan; gambar dimuat lewat `CATALOG_FILES_PATH + id` (origin `app://qc`). */
export interface CatalogSnapshot {
  catalog: DesktopCatalogDto;
  syncedAt: string;
}

/**
 * Konfigurasi mode Multi dari renderer: kredensial dasar TIDAK ikut (proses utama membacanya dari paket skrip aktif,
 * merk selalu Ubiquiti), jadi sandi tak pernah lewat renderer.
 */
export type MultiStartDto = Omit<MultiStartConfig, 'base'>;

export interface MultiCredentialDto {
  username: string;
  password: string;
}

export interface QcBridge {
  version: number;
  package: {
    load(): Promise<PackageDto | null>;
    chooseDir(): Promise<PackageDto | null>;
  };
  device: {
    ping(host: string): Promise<PingResult>;
    readInfo(req: DeviceRequest): Promise<DeviceInfoResult>;
    readRouterInfo(req: DeviceRequest): Promise<RouterInfoResult>;
  };
  inject: {
    run(req: InjectRequest): Promise<InjectResult>;
    cancel(id: string): Promise<void>;
    onProgress(cb: (e: { id: string } & InjectProgressDto) => void): () => void;
  };
  auth: {
    status(): Promise<AuthStatus>;
    /** Membuka peramban sistem untuk login; hasilnya datang lewat `onChange`. */
    login(): Promise<void>;
    logout(): Promise<void>;
    onChange(cb: (s: AuthStatus) => void): () => void;
  };
  ui: {
    /** Bundel UI baru siap; diterapkan pada peluncuran berikutnya atau lewat `reload()`. */
    onUpdateReady(cb: (info: UiUpdateInfo) => void): () => void;
    /** Menerapkan bundel siap (bila tak ada inject berjalan) lalu memuat ulang jendela. */
    reload(): Promise<void>;
  };
  /** Jembatan v5 (`CATALOG_BRIDGE_VERSION`): katalog Tipe offline; pemakai memeriksa versinya. */
  catalog: {
    /** Katalog tersimpan (cache lokal), atau `null` bila belum pernah tersinkron. Tanpa jaringan. */
    get(): Promise<CatalogSnapshot | null>;
    /** Menyinkronkan dari server sekarang; mengembalikan status akhir. */
    refresh(): Promise<CatalogStatus>;
    status(): Promise<CatalogStatus>;
    onChange(cb: (status: CatalogStatus) => void): () => void;
  };
  /** Jembatan v4 (`NOTIFICATIONS_BRIDGE_VERSION`); tak ada di aplikasi desktop lama, jadi pemakai memeriksa versinya. */
  notifications: {
    /** Ada notifikasi baru (tanpa muatan): muat ulang lonceng. Mengembalikan fungsi berhenti mendengarkan. */
    onChange(cb: () => void): () => void;
  };
  pending: {
    list(): Promise<PendingEntry[]>;
    add(entry: PendingEntry): Promise<AddResult>;
    remove(serial: string): Promise<void>;
  };
  /**
   * Jembatan v8 (`DRAFT_BRIDGE_VERSION`): snapshot draft Catat Serial Number di SQLite proses utama. Isinya objek bebas
   * dari sisi proses utama (hanya disimpan; renderer menyaring bentuknya saat membaca), dibatasi baris dan ukurannya.
   * `load` melempar galat bila berkas draft rusak: renderer tidak boleh menimpanya dengan snapshot kosong.
   */
  draft: {
    load(): Promise<unknown[]>;
    save(rows: readonly unknown[]): Promise<void>;
  };
  /**
   * Jembatan v9 (`MULTI_BRIDGE_VERSION`): mode Multi-Device (Ubiquiti). Mesinnya hidup di proses utama; renderer hanya
   * mengirim perintah dan menampilkan snapshot (tanpa sandi). `mac` selalu `AA:BB:CC:DD:EE:FF`. Pada jembatan < v9 field
   * ini tidak ada (pemakai memeriksa `version`/`MULTI_BRIDGE_VERSION`).
   */
  multi: {
    start(cfg: MultiStartDto): Promise<void>;
    stop(): Promise<void>;
    scan(): Promise<void>;
    setConcurrency(n: number): Promise<void>;
    setAutoInject(on: boolean): Promise<void>;
    injectDevice(mac: string): Promise<void>;
    cancelDevice(mac: string): Promise<void>;
    injectAll(): Promise<void>;
    stopQueue(): Promise<void>;
    cancelAll(): Promise<void>;
    addCredential(cred: MultiCredentialDto): Promise<void>;
    /** Alasan inject ditahan (draft penuh/rusak/belum termuat), atau `null` untuk melepas. */
    setBlocked(reason: string | null): Promise<void>;
    /** Serial yang sudah ada di draft (sumber kebenaran = tabel draft di renderer). */
    setRegistered(serials: readonly string[]): Promise<void>;
    prepareBridge(): Promise<{ ok: boolean; message: string }>;
    snapshot(): Promise<MultiSnapshot>;
    /** Peristiwa inject sukses yang belum di-ack; dikirim ulang sampai `ackInjected`. */
    pendingEvents(): Promise<InjectedEvent[]>;
    ackInjected(eventIds: readonly string[]): Promise<void>;
    /** Membuka `https://<ip>` perangkat (hanya MAC yang ada di snapshot) di peramban sistem. */
    openWeb(mac: string): Promise<void>;
    onChange(cb: (s: MultiSnapshot) => void): () => void;
  };
}

// --- Skema validasi -----------------------------------------------------------------------

/** Ada karakter kontrol (C0, DEL, C1)? Dipakai pada nilai yang berakhir di UI, log, atau perintah. */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

const plain = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => !hasControlChars(v), 'Karakter kontrol tidak diperbolehkan');

export const BrandSchema = z.enum(['mikrotik', 'ubiquiti']);
export const HostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine(isValidHost, 'Host harus alamat IPv4 atau nama host yang sah');

/** Id inject dibuat renderer; dibatasi agar aman dipakai sebagai kunci peta dan di log. */
export const InjectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Id hanya boleh huruf, angka, "_" dan "-"');

const UsernameSchema = plain(128);
// Kata sandi boleh kosong (Mikrotik `admin` bawaan tanpa sandi), tetapi dibatasi panjangnya.
const PasswordSchema = plain(256, 0);

export const DeviceRequestSchema = z.strictObject({
  brand: BrandSchema,
  host: HostSchema,
  username: UsernameSchema,
  password: PasswordSchema,
});

export const InjectRequestSchema = z.strictObject({
  id: InjectIdSchema,
  brand: BrandSchema,
  firmwareCode: plain(100),
  target: z.strictObject({
    ip: HostSchema,
    username: UsernameSchema,
    password: PasswordSchema,
  }),
});

const IsoTimestamp = z.iso.datetime({ offset: true });

export const PendingEntrySchema = z.strictObject({
  serial: plain(64).refine((v) => v.trim().length > 0, 'Serial tidak boleh kosong'),
  brand: z.enum(['mikrotik', 'ubiquiti', 'none']),
  tipe: plain(128, 0),
  // BU dan lokasi tujuan unggah (jembatan v6, `PENDING_TARGET_BRIDGE_VERSION`): id dari katalog offline + label tampilan.
  buId: plain(100).optional(),
  buLabel: plain(200, 0).optional(),
  locationId: plain(100).optional(),
  locationLabel: plain(200, 0).optional(),
  // Bahan unggah (jembatan v7): id Tipe katalog (= item Serial Number) dan kunci idempoten per baris.
  itemId: plain(100).optional(),
  clientId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,100}$/, 'clientId tidak valid')
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD'),
  timestamp: IsoTimestamp,
  reinjectedAt: IsoTimestamp.optional(),
});

/** Snapshot draft: daftar objek, dibatasi jumlah baris dan ukuran JSON (renderer tidak tepercaya). */
export const DraftRowsSchema = z
  .array(z.record(z.string(), z.unknown()))
  .max(DRAFT_MAX_ROWS)
  .refine((rows) => JSON.stringify(rows).length <= DRAFT_MAX_BYTES, 'Draft terlalu besar');

export const SerialArgSchema = plain(64).refine(
  (v) => v.trim().length > 0,
  'Serial tidak boleh kosong',
);

// --- Skema mode Multi (jembatan v9) -------------------------------------------------------

const ConcurrencySchema = z.number().int().min(1).max(32);

/** MAC dari renderer: panjang dibatasi SEBELUM normalisasi; hasil parse sudah `AA:BB:CC:DD:EE:FF`. */
export const MacArgSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const mac = normalizeMac(value);
    if (mac === null) {
      ctx.addIssue({ code: 'custom', message: 'MAC tidak valid' });
      return z.NEVER;
    }
    return mac;
  });

/** IPv4 ketat atau kosong (kosong = tak ada IP yang dikecualikan); nama host tidak diterima. */
const ExcludeIpSchema = z
  .string()
  .max(15)
  .refine((v) => v === '' || isIpv4(v), 'Exclude IP harus alamat IPv4 atau kosong');

export const MultiStartSchema = z.strictObject({
  firmwareCode: plain(100),
  concurrency: ConcurrencySchema,
  excludeIp: ExcludeIpSchema,
  autoInject: z.boolean(),
  target: z.strictObject({
    itemId: plain(100),
    itemLabel: plain(200, 0),
    buId: plain(100),
    buLabel: plain(200, 0),
    locationId: plain(100),
    locationLabel: plain(200, 0),
  }),
});

// Kredensial manual (satu-satunya skema multi yang memuat sandi). Keduanya wajib terisi.
export const MultiCredentialSchema = z.strictObject({
  username: UsernameSchema,
  password: plain(256, 1),
});

/**
 * Skema argumen per kanal (tuple: argumen berlebih ditolak). Dipegang di sini agar proses utama
 * tak perlu mengimpor zod sendiri dan agar kontrak serta validasinya satu tempat.
 */
export const BRIDGE_ARGS = {
  packageLoad: z.tuple([]),
  packageChooseDir: z.tuple([]),
  devicePing: z.tuple([HostSchema]),
  deviceReadInfo: z.tuple([DeviceRequestSchema]),
  deviceReadRouterInfo: z.tuple([DeviceRequestSchema]),
  injectRun: z.tuple([InjectRequestSchema]),
  injectCancel: z.tuple([InjectIdSchema]),
  pendingList: z.tuple([]),
  pendingAdd: z.tuple([PendingEntrySchema]),
  pendingRemove: z.tuple([SerialArgSchema]),
  draftLoad: z.tuple([]),
  draftSave: z.tuple([DraftRowsSchema]),
  authStatus: z.tuple([]),
  authLogin: z.tuple([]),
  authLogout: z.tuple([]),
  uiReload: z.tuple([]),
  catalogGet: z.tuple([]),
  catalogRefresh: z.tuple([]),
  catalogStatus: z.tuple([]),
  multiStart: z.tuple([MultiStartSchema]),
  multiStop: z.tuple([]),
  multiScan: z.tuple([]),
  multiSetConcurrency: z.tuple([ConcurrencySchema]),
  multiSetAutoInject: z.tuple([z.boolean()]),
  multiInjectDevice: z.tuple([MacArgSchema]),
  multiCancelDevice: z.tuple([MacArgSchema]),
  multiInjectAll: z.tuple([]),
  multiStopQueue: z.tuple([]),
  multiCancelAll: z.tuple([]),
  multiAddCredential: z.tuple([MultiCredentialSchema]),
  multiSetBlocked: z.tuple([z.union([z.null(), plain(200)])]),
  multiSetRegistered: z.tuple([z.array(SerialArgSchema).max(DRAFT_MAX_ROWS)]),
  multiPrepareBridge: z.tuple([]),
  multiSnapshot: z.tuple([]),
  multiPendingEvents: z.tuple([]),
  multiAckInjected: z.tuple([z.array(InjectIdSchema).max(MULTI_ACK_MAX)]),
  multiOpenWeb: z.tuple([MacArgSchema]),
} as const satisfies Record<keyof typeof BRIDGE_CHANNELS, z.ZodType>;

// --- Teks progres aman untuk renderer ------------------------------------------------------

const ESC = 0x1b;

function isCsiParam(code: number): boolean {
  return code >= 0x30 && code <= 0x3f;
}
function isIntermediate(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

/**
 * Membuang urutan escape terminal (CSI, OSC, escape dua karakter) dan karakter kontrol dari teks
 * yang berasal dari shell perangkat; CR/LF/TAB menjadi satu spasi. Dipanggil SEBELUM menyamarkan
 * sandi: urutan ANSI yang disisipkan di tengah sandi tak boleh membuat penyamaran terlewat.
 */
export function stripTerminalControl(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === ESC) {
      const next = text.charCodeAt(i + 1);
      if (next === 0x5b /* [ */) {
        i += 2;
        while (i < text.length && isCsiParam(text.charCodeAt(i))) i += 1;
        while (i < text.length && isIntermediate(text.charCodeAt(i))) i += 1;
        if (i < text.length && text.charCodeAt(i) >= 0x40 && text.charCodeAt(i) <= 0x7e) i += 1;
      } else if (next === 0x5d /* ] */) {
        i += 2;
        while (i < text.length) {
          const c = text.charCodeAt(i);
          if (c === 0x07) {
            i += 1;
            break;
          }
          if (c === ESC && text.charCodeAt(i + 1) === 0x5c) {
            i += 2;
            break;
          }
          i += 1;
        }
      } else {
        i += 1;
        while (i < text.length && isIntermediate(text.charCodeAt(i))) i += 1;
        if (i < text.length) i += 1;
      }
      continue;
    }
    if (code === 0x0d && text.charCodeAt(i + 1) === 0x0a) {
      i += 1;
      continue;
    }
    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out += ' ';
    } else if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
      out += text[i];
    }
    i += 1;
  }
  return out;
}
