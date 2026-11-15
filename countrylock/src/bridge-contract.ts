// Kontrak jembatan renderer <-> proses utama (spek §6): tipe `QcBridge`, DTO, dan skema zod yang
// dipakai proses utama untuk memvalidasi SETIAP argumen IPC. Renderer tidak tepercaya: semua
// string dibatasi panjangnya, host harus sah, dan karakter kontrol ditolak.

import { z } from 'zod';
import type { BRIDGE_CHANNELS } from './bridge-channels';
import type { CountryLockConfig } from './config';
import type { DeviceInfo } from './device-info';
import { isValidHost } from './host';
import type { PingKind } from './inject-plan';
import type { AddResult, PendingEntry } from './pending';
import type { Brand } from './script-template';

export {
  AUTH_CHANGE_EVENT,
  BRIDGE_CHANNELS,
  BRIDGE_VERSION,
  INJECT_PROGRESS_EVENT,
  MIN_BRIDGE_VERSION,
  UI_UPDATE_READY_EVENT,
} from './bridge-channels';

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
  pending: {
    list(): Promise<PendingEntry[]>;
    add(entry: PendingEntry): Promise<AddResult>;
    remove(serial: string): Promise<void>;
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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD'),
  timestamp: IsoTimestamp,
  reinjectedAt: IsoTimestamp.optional(),
});

export const SerialArgSchema = plain(64).refine(
  (v) => v.trim().length > 0,
  'Serial tidak boleh kosong',
);

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
  authStatus: z.tuple([]),
  authLogin: z.tuple([]),
  authLogout: z.tuple([]),
  uiReload: z.tuple([]),
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
