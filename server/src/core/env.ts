import type { Db } from '@server/core/db';
import type { BridgeClient } from './bridge-client';
import type { FileCache } from './file-cache';
import type { GoogleSettings } from './google/settings';
import type { Mailer } from './mail';

/**
 * Objek konfigurasi aplikasi yang diteruskan ke seluruh rute dan layanan: koneksi basis data dan rahasia
 * (dibangun dari `Config` oleh `createServer`; lihat `config.ts`).
 */
/** Pembangkit dump basis data: menulis dump yang sudah di-gzip ke `outputPath` (lihat `modules/backup/dump.ts`). */
export type DumpRunner = (outputPath: string) => Promise<void>;

export interface Env extends GoogleSettings {
  DB: Db;
  SESSION_SECRET: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SYNC_API_TOKEN: string;
  /** Email super admin (setara Script Property ADMIN_EMAIL di Apps Script). */
  ADMIN_EMAIL: string;
  /**
   * Origin aplikasi untuk redirect OAuth (mis. `https://qc.example.com`). Bila kosong, dipakai origin
   * permintaan.
   */
  APP_ORIGIN?: string;
  /** HANYA pengembangan lokal (`server/.env`): email untuk `/auth/dev-login`; jangan pernah diset di produksi. */
  DEV_LOGIN_EMAIL?: string;
  /** Klien Google (Drive/Sheets): disuntik `envFromConfig` (nyata) atau tes (palsu); bila kosong dibuat dari field Google di atas. */
  BRIDGE?: BridgeClient;
  /**
   * Cadangan (T30): dijalankan penjadwal HANYA bila true (`envFromConfig`: produksi dengan Google terkonfigurasi);
   * dev dan tes tidak pernah men-dump basis data tanpa menyuntiknya sendiri.
   */
  BACKUP_ENABLED?: boolean;
  /** Pembangkit dump (nyata: `mariadb-dump`; tes: tiruan). */
  BACKUP_DUMP?: DumpRunner;
  /** Folder lokal (volume yang dapat ditulis) tempat dump disimpan sementara; 3 salinan terakhir dipertahankan. */
  BACKUP_LOCAL_DIR?: string;
  /** Pengirim email peringatan (T32); kosong = SMTP/`ALERT_TO` belum dikonfigurasi, peringatan dilewati dan dicatat. */
  MAILER?: Mailer;
  /** Penerima peringatan (`ALERT_TO`). */
  ALERT_TO?: string[];
  /** Ambang peringatan pemakaian kuota Drive, persen (bawaan 80). */
  QUOTA_ALERT_PERCENT?: number;
  /** Hanya untuk tes: jam terkendali (milidetik epoch). */
  NOW?: () => number;
  /** Hanya untuk tes: cache isi berkas (bawaan: cache memori LRU proses, maks. 32 MB; null = tanpa cache). */
  FILE_CACHE?: FileCache | null;
}

export function nowOf(env: Env): number {
  return env.NOW ? env.NOW() : Date.now();
}

/** Waktu sekarang sebagai ISO 8601 UTC. */
export function nowIso(env: Env): string {
  return new Date(nowOf(env)).toISOString();
}
