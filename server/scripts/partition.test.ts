import { describe, expect, test } from 'bun:test';
import { type FileWeight, parseShard, partitionFiles, pickShardFiles } from './partition';

/** 20 berkas dengan ukuran tetap yang beragam (deterministik, tanpa acak). */
function sampleFiles(): FileWeight[] {
  return Array.from({ length: 20 }, (_, i) => ({
    file: `src/modul/berkas-${String(i).padStart(2, '0')}.test.ts`,
    size: ((i * 37) % 23) * 1000 + 500,
  }));
}

function loadOf(group: string[], items: FileWeight[]): number {
  const sizes = new Map(items.map((item) => [item.file, item.size]));
  return group.reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);
}

describe('partitionFiles', () => {
  test('mengembalikan tepat count kelompok', () => {
    expect(partitionFiles(sampleFiles(), 8)).toHaveLength(8);
    expect(partitionFiles(sampleFiles(), 3)).toHaveLength(3);
  });

  test('tiap berkas tepat di satu kelompok dan gabungan = masukan', () => {
    const items = sampleFiles();
    const all = partitionFiles(items, 8).flat();
    expect(all.sort()).toEqual(items.map((item) => item.file).sort());
  });

  test('deterministik: urutan masukan diacak menghasilkan kelompok yang sama', () => {
    const items = sampleFiles();
    const shuffled = [...items].reverse();
    shuffled.push(shuffled.shift() as FileWeight);
    expect(partitionFiles(shuffled, 8)).toEqual(partitionFiles(items, 8));
  });

  test('berkas lebih sedikit dari count menyisakan kelompok kosong tetapi tetap count kelompok', () => {
    const items = sampleFiles().slice(0, 3);
    const groups = partitionFiles(items, 8);
    expect(groups).toHaveLength(8);
    expect(groups.filter((group) => group.length === 0)).toHaveLength(5);
  });

  test('beban seimbang: selisih beban terbesar-terkecil <= ukuran berkas terbesar', () => {
    const items = sampleFiles();
    const loads = partitionFiles(items, 8).map((group) => loadOf(group, items));
    const largest = Math.max(...items.map((item) => item.size));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(largest);
  });

  test('tiap kelompok terurut alfabetis', () => {
    for (const group of partitionFiles(sampleFiles(), 4)) {
      expect(group).toEqual([...group].sort());
    }
  });
});

describe('parseShard', () => {
  test('undefined dan string kosong berarti tanpa shard', () => {
    expect(parseShard(undefined)).toBeNull();
    expect(parseShard('')).toBeNull();
  });

  test('bentuk sah diurai', () => {
    expect(parseShard('3/8')).toEqual({ index: 3, total: 8 });
    expect(parseShard('1/1')).toEqual({ index: 1, total: 1 });
    expect(parseShard('64/64')).toEqual({ index: 64, total: 64 });
  });

  test('bentuk tak sah ditolak', () => {
    for (const bad of ['0/8', '9/8', '3', 'a/8', '3/0', '1/65', '3/8x', ' 3/8', '3/ 8', '-1/8']) {
      expect(() => parseShard(bad), bad).toThrow();
    }
  });
});

describe('pickShardFiles', () => {
  test('mengambil kelompok ke-i dari n (indeks 1-based) dan konsisten dengan partitionFiles', () => {
    const items = sampleFiles();
    const groups = partitionFiles(items, 8);
    for (let index = 1; index <= 8; index++) {
      expect(pickShardFiles(items, { index, total: 8 })).toEqual(groups[index - 1] as string[]);
    }
  });

  test('shard kosong sah bila ada berkas (mengembalikan daftar kosong)', () => {
    const items = sampleFiles().slice(0, 3);
    expect(pickShardFiles(items, { index: 8, total: 8 })).toEqual([]);
  });

  test('tanpa berkas tes sama sekali GAGAL (jangan lolos diam-diam di semua shard)', () => {
    expect(() => pickShardFiles([], { index: 1, total: 8 })).toThrow('Tidak ada berkas tes');
  });
});
