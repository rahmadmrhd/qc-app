/**
 * Berkas/direktori tes yang sudah dipindah ke MariaDB (transisi T5..T13). `scripts/test.ts` hanya menjalankan
 * daftar ini; "aktifkan tes <modul>" = tambahkan direktori modul itu di sini. Dihapus di T13 (skrip `test`
 * kembali `bun test`).
 */
export const PORTED: readonly string[] = [
  'src/core',
  'src/modules/access',
  'src/modules/auth',
  'src/modules/brand',
  'src/modules/customer',
  'src/http',
  'test-support',
];

/**
 * Berkas tes di dalam daftar PORTED yang dikecualikan sementara (bergantung pada modul yang belum dipindah
 * atau pada cache memori yang dibuang), beserta alasannya.
 */
export const EXCLUDED: Readonly<Record<string, string>> = {
  'src/core/mem-cache.test.ts': 'modul mem-cache dan tesnya dihapus di T13 (cache dimatikan)',
};
