import type { Db } from '@server/core/db';
import type { VerifyPorts } from '@server/modules/backup/verify';
import type { PushSender } from '@server/modules/notification/push';
import type { ProofStore } from '@server/modules/serial/proof/store';
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
  /** Email super admin. */
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
  /**
   * Pabrik koneksi uji pemulihan cadangan (nyata: `RESTORE_DATABASE_URL`, pengguna terbatas `qc_restore`; tes: tiruan);
   * kosong = verifikasi cadangan dinonaktifkan. Hanya berjalan bila `BACKUP_ENABLED`.
   */
  BACKUP_VERIFY?: () => Promise<VerifyPorts>;
  /** Folder lokal (volume yang dapat ditulis) tempat dump disimpan sementara; 3 salinan terakhir dipertahankan. */
  BACKUP_LOCAL_DIR?: string;
  /** Penyimpanan sementara foto bukti QC (disk server); `createServer` membuatnya dari `PROOF_STAGING_DIR`, tes memakai folder sementara. */
  PROOF_STORE?: ProofStore;
  /** Batas total ukuran berkas sementara foto bukti (byte); kosong = bawaan 2 GiB. */
  PROOF_STAGING_MAX_BYTES?: number;
  /** Pengirim Web Push (kunci VAPID terkonfigurasi); kosong = push dinonaktifkan (notifikasi push ditandai `skipped`). */
  PUSH?: PushSender;
  /** Kunci publik VAPID (base64url) untuk klien; bersama `PUSH`. */
  VAPID_PUBLIC_KEY?: string;
  /** Token bersama katalog Tipe offline desktop; kosong/tak diisi = rute katalog dinonaktifkan (404 seragam). */
  DESKTOP_CATALOG_TOKEN?: string;
  /** Pengirim email peringatan (T32); kosong = SMTP/`ALERT_TO` belum dikonfigurasi, peringatan dilewati dan dicatat. */
  MAILER?: Mailer;
  /** Penerima peringatan (`ALERT_TO`). */
  ALERT_TO?: string[];
  /** Ambang peringatan pemakaian kuota Drive, persen (bawaan 80). */
  QUOTA_ALERT_PERCENT?: number;
  /** SHA commit build image (`config.buildSha`); kosong = `unknown` di `/api/ping`. */
  BUILD_SHA?: string;
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
