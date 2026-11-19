import { describe, expect, test } from 'bun:test';
import { evaluateGuard } from './release-guard';

const META = [
  'server/package.json',
  'bun.lock',
  'server/CHANGELOG.md',
  'server/changelog.d/20261117-a.md',
];

describe('evaluateGuard: perbandingan terpotong', () => {
  test('300 berkas atau lebih (batas API compare; daftar terpotong diam-diam) ditolak, gagal tertutup', () => {
    for (const fileCount of [300, 301, 5000]) {
      const result = evaluateGuard({
        compareStatus: 'ahead',
        files: META,
        fileCount,
        changelogHasVersion: true,
      });
      expect(result.ok, String(fileCount)).toBe(false);
      expect(result.reason).toMatch(/staging/i);
    }
  });

  test('299 berkas masih dinilai dari daftarnya; jumlah bukan angka dianggap tak dapat dipercaya', () => {
    expect(
      evaluateGuard({
        compareStatus: 'ahead',
        files: META,
        fileCount: META.length,
        changelogHasVersion: true,
      }).ok,
    ).toBe(true);
    expect(
      evaluateGuard({
        compareStatus: 'ahead',
        files: META,
        fileCount: Number.NaN,
        changelogHasVersion: true,
      }).ok,
    ).toBe(false);
  });
});

describe('evaluateGuard', () => {
  test('ahead + hanya berkas metadata + CHANGELOG punya bagian versi = lulus', () => {
    expect(
      evaluateGuard({
        compareStatus: 'ahead',
        files: META,
        fileCount: 4,
        changelogHasVersion: true,
      }),
    ).toEqual({ ok: true, reason: expect.any(String) });
  });

  test('identical dengan daftar berkas kosong juga lulus', () => {
    expect(
      evaluateGuard({ compareStatus: 'identical', files: [], changelogHasVersion: true }).ok,
    ).toBe(true);
  });

  test('diverged atau behind ditolak (staging bukan leluhur commit rilis)', () => {
    for (const compareStatus of ['diverged', 'behind', '', 'apa-saja']) {
      const result = evaluateGuard({ compareStatus, files: META, changelogHasVersion: true });
      expect(result.ok, compareStatus).toBe(false);
      expect(result.reason).toMatch(/staging/i);
    }
  });

  test('satu berkas non-metadata di antara berkas metadata ditolak dan pesannya menyebut cara pulih', () => {
    const result = evaluateGuard({
      compareStatus: 'ahead',
      files: [...META, 'server/src/app.ts'],
      changelogHasVersion: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/staging/i);
    expect(result.reason).toMatch(/workflow_dispatch|jalankan ulang/i);
  });

  test('berkas desktop/package.json pada rilis server ditolak', () => {
    const result = evaluateGuard({
      compareStatus: 'ahead',
      files: [...META, 'desktop/package.json'],
      changelogHasVersion: true,
    });
    expect(result.ok).toBe(false);
  });

  test('CHANGELOG tanpa bagian versi ditolak', () => {
    const result = evaluateGuard({
      compareStatus: 'ahead',
      files: META,
      changelogHasVersion: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/CHANGELOG/);
  });
});

describe('evaluateGuard: rilis gabungan (komponen server + desktop)', () => {
  const BOTH_META = [
    ...META,
    'desktop/package.json',
    'desktop/CHANGELOG.md',
    'desktop/changelog.d/20261117-b.md',
  ];
  const input = (files: string[], components?: Array<'server' | 'desktop'>) => ({
    compareStatus: 'ahead',
    files,
    fileCount: files.length,
    changelogHasVersion: true,
    ...(components ? { components } : {}),
  });

  test('metadata kedua komponen lulus bila komponen yang dirilis menyebut keduanya', () => {
    expect(evaluateGuard(input(BOTH_META, ['server', 'desktop'])).ok).toBe(true);
  });

  test('tanpa daftar komponen (rilis server saja) metadata desktop tetap ditolak: perilaku lama tak berubah', () => {
    expect(evaluateGuard(input(BOTH_META)).ok).toBe(false);
    expect(evaluateGuard(input(BOTH_META, ['server'])).ok).toBe(false);
  });

  test('kode desktop atau berkas lain di luar metadata ditolak walau komponen desktop ikut dirilis', () => {
    expect(
      evaluateGuard(input([...BOTH_META, 'desktop/src/main/index.ts'], ['server', 'desktop'])).ok,
    ).toBe(false);
    expect(
      evaluateGuard(input([...BOTH_META, 'server/src/app.ts'], ['server', 'desktop'])).ok,
    ).toBe(false);
  });
});
