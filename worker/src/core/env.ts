import type { JobKind } from '@shared/rpc';
import type { BridgeClient } from './bridge-client';
import type { FileCache } from './file-cache';

/** Pesan antrean pekerjaan: hanya pengenal (data ada di D1); `step` informatif, kebenaran ada di baris `jobs`. */
export interface JobMessage {
  jobId: string;
  kind: JobKind;
  step: number;
}

/** Binding, variabel, dan rahasia Worker (lihat wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SYNC_API_TOKEN: string;
  BRIDGE_URL: string;
  BRIDGE_SECRET: string;
  /** Email super admin (setara Script Property ADMIN_EMAIL di Apps Script). */
  ADMIN_EMAIL: string;
  /**
   * Origin aplikasi untuk redirect OAuth (mis. `https://qc.example.workers.dev`). Bila kosong,
   * dipakai origin permintaan.
   */
  APP_ORIGIN?: string;
  /** HANYA pengembangan lokal (`.dev.vars`): email untuk `/auth/dev-login`; jangan pernah diset di produksi. */
  DEV_LOGIN_EMAIL?: string;
  /**
   * TTL cache memori isolate dalam milidetik (bawaan 10000, maks. 15000; `0` = mati). Lihat `mem-cache.ts`.
   */
  CACHE_TTL_MS?: string;
  /** Hanya untuk tes: klien jembatan palsu dan jam terkendali (milidetik epoch). */
  BRIDGE?: BridgeClient;
  NOW?: () => number;
  /** Hanya untuk tes: cache isi berkas (bawaan: Cache API Workers). */
  FILE_CACHE?: FileCache | null;
}

export function nowOf(env: Env): number {
  return env.NOW ? env.NOW() : Date.now();
}

/** Waktu sekarang sebagai ISO 8601 UTC. */
export function nowIso(env: Env): string {
  return new Date(nowOf(env)).toISOString();
}
