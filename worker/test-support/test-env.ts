import type { Env, JobMessage } from '@worker/core/env';
import { resetMemCache } from '@worker/core/mem-cache';
import { applyMigrations } from '@worker/core/migrate';
import { createFakeBridge, type FakeBridge } from './fake-bridge';
import { createSqliteD1 } from './sqlite-d1';

export interface TestClock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export interface TestEnv extends Env {
  clock: TestClock;
  /** Pesan yang dikirim ke antrean `JOBS`. */
  queued: JobMessage[];
  BRIDGE: FakeBridge;
}

/** Env uji: D1 baru (skema dimigrasi), antrean dan jembatan palsu, rahasia uji, jam terkendali. */
export async function createTestEnv(overrides: Partial<Env> = {}): Promise<TestEnv> {
  let current = Date.parse('2026-01-15T03:00:00.000Z');
  const clock: TestClock = {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
  const queued: JobMessage[] = [];
  const jobs = {
    async send(message: JobMessage) {
      queued.push(message);
    },
    async sendBatch(messages: Iterable<{ body: JobMessage }>) {
      for (const m of messages) queued.push(m.body);
    },
  } as unknown as Queue<JobMessage>;
  const assets = {
    async fetch() {
      return new Response('aset statis', { status: 200 });
    },
  } as unknown as Fetcher;
  // Cache memori isolate (variabel modul) tidak boleh bocor antar tes: bersihkan dan, kecuali diminta,
  // matikan (`CACHE_TTL_MS=0`). Seluruh suite dapat dijalankan dengan cache menyala lewat
  // `QC_TEST_CACHE_TTL_MS=10000 bun test` untuk memeriksa invalidasi.
  resetMemCache();
  const db = createSqliteD1();
  await applyMigrations(db);
  return {
    DB: db,
    JOBS: jobs,
    ASSETS: assets,
    SESSION_SECRET: 'test-session-secret',
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    SYNC_API_TOKEN: 'test-sync-token',
    BRIDGE_URL: 'https://bridge.test/exec',
    BRIDGE_SECRET: 'test-bridge-secret',
    ADMIN_EMAIL: 'admin@gmail.com',
    APP_ORIGIN: 'https://qc.test',
    NOW: () => clock.now(),
    CACHE_TTL_MS: process.env.QC_TEST_CACHE_TTL_MS ?? '0',
    ...overrides,
    BRIDGE: (overrides.BRIDGE as FakeBridge | undefined) ?? createFakeBridge(),
    clock,
    queued,
  };
}
