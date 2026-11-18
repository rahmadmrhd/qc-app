import { describe, expect, test } from 'bun:test';
import { evaluateGuard } from './release-guard';

const META = [
  'server/package.json',
  'bun.lock',
  'server/CHANGELOG.md',
  'server/changelog.d/20261117-a.md',
];

describe('evaluateGuard', () => {
  test('ahead + hanya berkas metadata + CHANGELOG punya bagian versi = lulus', () => {
    expect(
      evaluateGuard({ compareStatus: 'ahead', files: META, changelogHasVersion: true }),
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
