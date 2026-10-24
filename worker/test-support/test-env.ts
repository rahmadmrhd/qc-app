import { applyMigrations } from '@worker/core/migrate';
import type { BridgeClient, Env, JobMessage } from '@worker/env';
import { createSqliteD1 } from './sqlite-d1';

export interface TestClock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export interface FakeBridge extends BridgeClient {
  calls: { action: string; payload: unknown }[];
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
  const bridge: FakeBridge = {
    calls: [],
    async call(action, payload) {
      bridge.calls.push({ action, payload });
      return {};
    },
  };
  const jobs = {
    async send(message: JobMessage) {
      queued.push(message);
    },
    async sendBatch(messages: Iterable<{ body: JobMessage }>) {
      for (const m of messages) queued.push(m.body);
    },
  } as unknown as Queue<JobMessage>;
  const db = createSqliteD1();
  await applyMigrations(db);
  return {
    DB: db,
    JOBS: jobs,
    SESSION_SECRET: 'test-session-secret',
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    SYNC_API_TOKEN: 'test-sync-token',
    BRIDGE_URL: 'https://bridge.test/exec',
    BRIDGE_SECRET: 'test-bridge-secret',
    NOW: () => clock.now(),
    ...overrides,
    BRIDGE: (overrides.BRIDGE as FakeBridge | undefined) ?? bridge,
    clock,
    queued,
  };
}
