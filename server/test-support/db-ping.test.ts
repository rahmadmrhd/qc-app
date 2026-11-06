import { describe, expect, test } from 'bun:test';
import { testDbUrl } from './db-env';
import { pingDatabase } from './db-ping';

describe('pingDatabase (M4)', () => {
  test('MariaDB yang menjawab: SELECT 1 berhasil', async () => {
    await pingDatabase(testDbUrl());
  }, 30_000);

  test('port terbuka tetapi tidak menjawab handshake (tunnel setengah-terbuka): gagal dalam batas waktu, bukan menggantung', async () => {
    const silent = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { open() {}, data() {}, close() {}, error() {} },
    });
    try {
      const started = performance.now();
      await expect(
        pingDatabase(`mysql://qc_test:x@127.0.0.1:${silent.port}/`, 500),
      ).rejects.toThrow(/tidak menjawab dalam 500 ms/);
      expect(performance.now() - started).toBeLessThan(3_000);
    } finally {
      silent.stop(true);
    }
  }, 30_000);

  test('port tertutup: gagal cepat dengan galat koneksi', async () => {
    await expect(pingDatabase('mysql://qc_test:x@127.0.0.1:1/', 5_000)).rejects.toThrow();
  }, 30_000);
});
