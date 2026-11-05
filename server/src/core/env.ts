import type { Db } from '@server/core/db';
import type { BridgeClient } from './bridge-client';
import type { FileCache } from './file-cache';

/**
 * Objek konfigurasi aplikasi yang diteruskan ke seluruh rute dan layanan: koneksi basis data dan rahasia
 * (dibangun dari `Config` oleh `createServer`; lihat `config.ts`).
 */
export interface Env {
  DB: Db;
  SESSION_SECRET: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SYNC_API_TOKEN: string;
  BRIDGE_URL: string;
  BRIDGE_SECRET: string;
  /** Email super admin (setara Script Property ADMIN_EMAIL di Apps Script). */
  ADMIN_EMAIL: string;
  /**
   * Origin aplikasi untuk redirect OAuth (mis. `https://qc.example.com`). Bila kosong, dipakai origin
   * permintaan.
   */
  APP_ORIGIN?: string;
  /** HANYA pengembangan lokal (`server/.env`): email untuk `/auth/dev-login`; jangan pernah diset di produksi. */
  DEV_LOGIN_EMAIL?: string;
  /** Hanya untuk tes: klien jembatan palsu dan jam terkendali (milidetik epoch). */
  BRIDGE?: BridgeClient;
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
