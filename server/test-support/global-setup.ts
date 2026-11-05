// Dimuat lewat `bun test --preload` (lihat scripts/test.ts): menyiapkan templat skema dan membersihkan skema
// tes yatim sebelum tes pertama, lalu menghapus skema tes proses ini setelah seluruh berkas di proses itu selesai. Tanpa tunnel, gagal cepat
// dengan pesan yang menyebut `bun run db:tunnel`.
import { afterAll, setDefaultTimeout } from 'bun:test';
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

// Satu skema per PROSES tes: `afterAll` di berkas preload berlaku untuk seluruh proses (bukan per berkas); dihapus saat
// proses selesai.
afterAll(async () => {
  await dropTestSchemas();
});

// Tes memanggil MariaDB lewat jaringan (terowongan SSH saat dev): beberapa tes berantai banyak round trip dan
// melewati batas bawaan 5 dtk bila latensi sedang tinggi. Batas lebih longgar menghindari kegagalan acak
// (tes yang timeout juga membocorkan pekerjaan async ke tes berikutnya).
setDefaultTimeout(30_000);
