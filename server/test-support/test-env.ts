import type { Env } from '@server/core/env';
import { createFakeBridge, type FakeBridge } from './fake-bridge';
import { acquireTestDb, resetTestDb } from './test-db';

export interface TestClock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export interface TestEnv extends Env {
  clock: TestClock;
  BRIDGE: FakeBridge;
}

/** Env uji: skema MariaDB sementara per proses (dikloning dari templat, dikosongkan tiap panggilan), jembatan palsu, rahasia uji, jam terkendali. */
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
  const testDb = await acquireTestDb();
  await resetTestDb(testDb);
  return {
    DB: testDb.db,
    SESSION_SECRET: 'test-session-secret',
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    SYNC_API_TOKEN: 'test-sync-token',
    BRIDGE_URL: 'https://bridge.test/exec',
    BRIDGE_SECRET: 'test-bridge-secret',
    ADMIN_EMAIL: 'admin@gmail.com',
    APP_ORIGIN: 'https://qc.test',
    NOW: () => clock.now(),
    ...overrides,
    BRIDGE: (overrides.BRIDGE as FakeBridge | undefined) ?? createFakeBridge(),
    clock,
  };
}
