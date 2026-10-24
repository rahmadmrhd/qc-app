/** Klien jembatan Apps Script (antarmuka sementara; dirinci Task 1.4/3.2). */
export interface BridgeClient {
  call(action: string, payload: unknown): Promise<unknown>;
}

/** Pesan antrean pekerjaan: hanya pengenal; data diambil dari D1. */
export interface JobMessage {
  jobId: string;
  chunk?: number;
}

/** Binding dan rahasia Worker (lihat wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  SESSION_SECRET: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SYNC_API_TOKEN: string;
  BRIDGE_URL: string;
  BRIDGE_SECRET: string;
  /** Hanya untuk tes: jembatan palsu dan jam terkendali (milidetik epoch). */
  BRIDGE?: BridgeClient;
  NOW?: () => number;
}
