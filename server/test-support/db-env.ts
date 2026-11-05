import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TUNNEL_HINT =
  'QC_TEST_DB_URL kosong. Jalankan `bun run db:tunnel` di terminal lain dan isi server/.env.test (lihat server/.env.test.example).';

interface TestDbUrlOptions {
  env?: Record<string, string | undefined>;
  /** Berkas cadangan bila variabel belum dimuat (mis. `bun test` dari root repo, bukan server/). */
  file?: string;
}

/** URL MariaDB dev/test lewat tunnel SSH. Berakhiran `/` (tanpa nama database) untuk pengguna qc_test. */
export function testDbUrl(options: TestDbUrlOptions = {}): string {
  const env = options.env ?? process.env;
  const fromEnv = env.QC_TEST_DB_URL?.trim();
  if (fromEnv) return fromEnv;
  const file = options.file ?? join(import.meta.dir, '..', '.env.test');
  try {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('QC_TEST_DB_URL='));
    const value = line?.slice('QC_TEST_DB_URL='.length).trim();
    if (value) return value;
  } catch {
    // berkas tidak ada: jatuh ke galat di bawah
  }
  throw new Error(TUNNEL_HINT);
}

/** Awalan skema tes sementara; pola `qc_test_%` adalah satu-satunya yang boleh dibuat pengguna qc_test. */
export const TEST_SCHEMA_PREFIX = 'qc_test_';

/**
 * Nama skema sementara `qc_test_<epoch detik>_<hex>`. Stempel waktu memungkinkan pembersihan skema yatim milik
 * proses tes yang mati (`sweepOrphanSchemas`).
 */
export function newTestSchemaName(): string {
  const seconds = Math.floor(Date.now() / 1000);
  return `${TEST_SCHEMA_PREFIX}${seconds}_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
}
