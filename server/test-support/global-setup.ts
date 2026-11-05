// Dimuat lewat `bun test --preload` (lihat scripts/test.ts): menyiapkan templat skema dan membersihkan skema
// tes yatim sebelum tes pertama, lalu menghapus skema tes setiap berkas tes selesai. Tanpa tunnel, gagal cepat
// dengan pesan yang menyebut `bun run db:tunnel`.
import { afterAll } from 'bun:test';
import { createDb, toDbError } from '@server/core/db';
import { testDbUrl } from './db-env';
import { dropTestSchemas, ensureTemplate, sweepOrphanSchemas } from './test-db';

try {
  const admin = createDb({ url: testDbUrl(), connectionLimit: 1 });
  try {
    await ensureTemplate();
    await sweepOrphanSchemas(admin);
  } finally {
    await admin.close();
  }
} catch (error) {
  console.error(`\nGlobal setup tes gagal: ${toDbError(error).message}\n`);
  process.exit(1);
}

// Skema per berkas tes: dihapus di akhir tiap berkas; `createTestEnv` berikutnya mengkloning skema baru.
afterAll(async () => {
  await dropTestSchemas();
});
