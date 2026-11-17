// Logika murni runner tes server: pembagian berkas ke N kelompok dan pengurai `QC_TEST_SHARD`.
// Dipisah dari `test.ts` agar dapat diuji tanpa MariaDB dan dipakai ulang oleh mode shard di CI
// (matrix job `server` di .github/workflows/ci.yml: tiap job menjalankan kelompok ke-i dari 8).

export interface FileWeight {
  file: string;
  size: number;
}

/**
 * Pembagian seimbang: berkas terbesar dulu ke kelompok yang bebannya (ukuran berkas) paling kecil.
 * Mengembalikan TEPAT `count` kelompok (yang kosong dipertahankan) supaya indeks shard stabil di semua
 * runner; hasilnya deterministik untuk masukan yang sama (tie-break: nama berkas, lalu kelompok pertama).
 */
export function partitionFiles(items: FileWeight[], count: number): string[][] {
  const groups = Array.from({ length: count }, () => ({ files: [] as string[], load: 0 }));
  const bySize = [...items].sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : 1));
  for (const { file, size } of bySize) {
    const lightest = groups.reduce((min, group) => (group.load < min.load ? group : min));
    lightest.files.push(file);
    lightest.load += size;
  }
  return groups.map((group) => group.files.sort());
}

/** Batas jumlah shard yang masuk akal; mencegah salah ketik (mis. `1/800`) menjadi 800 kelompok. */
const MAX_TOTAL = 64;

/**
 * Mengurai `QC_TEST_SHARD` berbentuk `<i>/<n>` (1 <= i <= n <= 64). Tanpa nilai = `null` (mode lokal biasa).
 * Nilai yang tak sah melempar galat berpesan Indonesia (runner menjadikannya kode keluar 1).
 */
export function parseShard(value: string | undefined): { index: number; total: number } | null {
  if (value === undefined || value === '') return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = match ? Number(match[1]) : Number.NaN;
  const total = match ? Number(match[2]) : Number.NaN;
  if (!match || index < 1 || total < 1 || index > total || total > MAX_TOTAL) {
    throw new Error(
      `QC_TEST_SHARD="${value}" tidak sah: harus berbentuk <i>/<n> dengan 1 <= i <= n <= ${MAX_TOTAL} (contoh 3/8).`,
    );
  }
  return { index, total };
}

/**
 * Berkas milik shard ke-`index` dari `total` (1-based). Tanpa berkas tes sama sekali = GALAT: bila tidak, penemuan berkas
 * yang rusak (folder diganti nama, cwd salah) membuat kedelapan shard keluar 0 dan seluruh tes server "lulus" kosong.
 * Shard kosong tetap sah selama ada berkas di shard lain.
 */
export function pickShardFiles(
  items: FileWeight[],
  shard: { index: number; total: number },
): string[] {
  if (items.length === 0) throw new Error('Tidak ada berkas tes.');
  return partitionFiles(items, shard.total)[shard.index - 1] ?? [];
}
