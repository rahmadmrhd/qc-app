import { describe, expect, test } from 'bun:test';
import { backupName } from './names';
import { selectBackupsToDelete } from './retention';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-01-01T19:00:00Z'); // 02:00 WIB 2 Januari

/** n berkas harian berturut-turut (n-1 hari sebelum START .. START). */
function daily(count: number): { id: string; name: string }[] {
  return Array.from({ length: count }, (_, index) => {
    const name = backupName(START + (index - (count - 1)) * DAY);
    return { id: `id-${name}`, name };
  });
}

const names = (entries: { name: string }[]) => entries.map((entry) => entry.name).sort();

describe('retensi cadangan (fungsi murni)', () => {
  test('30 berkas harian -> tersisa 7 harian + 4 mingguan (11), yang terbaru selalu tersisa', () => {
    const entries = daily(30);
    const doomed = selectBackupsToDelete(entries);
    const kept = entries.filter((entry) => !doomed.includes(entry));
    expect(kept).toHaveLength(11);
    const newest = entries[29] as { name: string };
    expect(kept.map((entry) => entry.name)).toContain(newest.name);
    // 7 hari terakhir utuh
    for (const entry of entries.slice(23)) expect(kept).toContain(entry);
    // empat sisanya = berkas terbaru dari tiap pekan ISO berbeda, semuanya lebih tua dari 7 hari terakhir
    const weekly = kept.filter((entry) => !entries.slice(23).includes(entry));
    expect(weekly).toHaveLength(4);
    const weeks = new Set(weekly.map((entry) => entry.name.slice(10, 18)));
    expect(weeks.size).toBe(4);
  });

  test('hanya 3 berkas -> tidak ada yang dihapus', () => {
    expect(selectBackupsToDelete(daily(3))).toEqual([]);
  });

  test('pengaman minimum: 2 hari x 2 berkas (hanya 2 yang dipertahankan, < 3) -> tidak ada yang dihapus', () => {
    // Tanpa pengaman, 2 berkas lama (terbaru per hari dipertahankan) akan dihapus; keep.size = 2 < BACKUP_MIN_KEEP.
    const entries = [
      { id: 'a1', name: 'qc-backup-20260114-0200.sql.gz' },
      { id: 'a2', name: 'qc-backup-20260114-1500.sql.gz' },
      { id: 'b1', name: 'qc-backup-20260115-0200.sql.gz' },
      { id: 'b2', name: 'qc-backup-20260115-1500.sql.gz' },
    ];
    expect(selectBackupsToDelete(entries)).toEqual([]);
  });

  test('sampai 7 berkas harian -> tidak ada yang dihapus', () => {
    expect(selectBackupsToDelete(daily(7))).toEqual([]);
  });

  test('berkas bernama tak dikenal tidak pernah disentuh (dan tak dihitung)', () => {
    const entries = [
      ...daily(30),
      { id: 'a', name: 'catatan.txt' },
      { id: 'b', name: 'qc-backup-20260101-0200.sql.gz.partial' },
      { id: 'c', name: 'qc-backup-lama.sql.gz' },
    ];
    const doomed = selectBackupsToDelete(entries);
    expect(doomed.length).toBe(19);
    for (const name of [
      'catatan.txt',
      'qc-backup-20260101-0200.sql.gz.partial',
      'qc-backup-lama.sql.gz',
    ]) {
      expect(doomed.some((entry) => entry.name === name)).toBe(false);
    }
  });

  test('tidak bergantung pada jam sekarang: jeda dua bulan tidak menghabiskan cadangan (berbasis jumlah)', () => {
    const entries = daily(5).map((entry, index) => ({
      ...entry,
      name: backupName(START + index * DAY - 90 * DAY),
    }));
    expect(selectBackupsToDelete(entries)).toEqual([]);
  });

  test('beberapa berkas pada hari yang sama: hanya yang terbaru hari itu yang dihitung sebagai harian', () => {
    const entries = [
      { id: '1', name: 'qc-backup-20260110-0200.sql.gz' },
      { id: '2', name: 'qc-backup-20260110-1500.sql.gz' },
      ...[11, 12, 13, 14, 15, 16, 17].map((day) => ({
        id: `d${day}`,
        name: `qc-backup-202601${day}-0200.sql.gz`,
      })),
    ];
    // hari 10 jatuh di luar 7 hari terbaru -> calon mingguan: hanya yang terbaru (1500) tersisa
    expect(names(selectBackupsToDelete(entries))).toEqual(['qc-backup-20260110-0200.sql.gz']);
  });

  test('daftar kosong atau tanpa nama dikenal -> tidak ada yang dihapus', () => {
    expect(selectBackupsToDelete([])).toEqual([]);
    expect(selectBackupsToDelete([{ id: 'x', name: 'lain.bin' }])).toEqual([]);
  });

  test('nama kembar (id berbeda) tidak dihapus bila namanya dipertahankan', () => {
    const entries = [...daily(3), { id: 'dup', name: (daily(3)[2] as { name: string }).name }];
    expect(selectBackupsToDelete(entries)).toEqual([]);
  });
});
