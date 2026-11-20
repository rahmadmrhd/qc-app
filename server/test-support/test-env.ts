import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@server/core/env';
import { createMemoryFileCache } from '@server/core/file-cache';
import { createProofStore } from '@server/modules/serial/proof/store';
import { createFakeBridge, type FakeBridge } from './fake-bridge';
import { removeTempDirSync } from './safe-rm';
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

let proofRoot: string | null = null;
let proofSeq = 0;

/**
 * Folder sementara foto bukti untuk SATU env uji: satu akar per proses `bun test` (dihapus saat proses selesai) dan
 * satu subfolder baru per `createTestEnv`, jadi berkas antar tes dan antar berkas tes tak saling terlihat.
 */
function newProofDir(): string {
  if (proofRoot === null) {
    const root = mkdtempSync(join(tmpdir(), 'qc-test-proofs-'));
    proofRoot = root;
    process.on('exit', () => removeTempDirSync(root));
  }
  proofSeq += 1;
  return join(proofRoot, String(proofSeq));
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
    // Google: tak dikonfigurasi (BRIDGE selalu klien palsu); folder fungsi dibuat dan dicatat di tabel settings.
    GOOGLE_SA_KEY_FILE: '',
    GOOGLE_ROOT_FOLDER_ID: '',
    GOOGLE_SPREADSHEET_ID: '',
    ATTACHMENTS_FOLDER_ID: '',
    QR_FOLDER_ID: '',
    QR_DOC_FOLDER_ID: '',
    BACKUP_FOLDER_ID: '',
    DESKTOP_RELEASES_FOLDER_ID: '',
    ALLOWED_FOLDER_IDS: [],
    ADMIN_EMAIL: 'admin@gmail.com',
    APP_ORIGIN: 'https://qc.test',
    NOW: () => clock.now(),
    // Cache isi berkas milik env ini: id Drive jembatan palsu berulang antar-tes, jadi cache bawaan proses
    // (dipakai bila FILE_CACHE kosong) akan mengembalikan isi tes sebelumnya.
    FILE_CACHE: createMemoryFileCache(),
    // Penyimpanan sementara foto bukti QC: folder sementara milik env ini (dibuat saat tulis pertama).
    PROOF_STORE: createProofStore(newProofDir()),
    ...overrides,
    BRIDGE: (overrides.BRIDGE as FakeBridge | undefined) ?? createFakeBridge(),
    clock,
  };
}
