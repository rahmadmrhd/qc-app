import { describe, expect, test } from 'bun:test';
import { checkIdentity, type IdentityInput } from './release-identity';

const ok: IdentityInput = {
  baseRepo: 'pemilik/qc-app',
  headRepo: 'pemilik/qc-app',
  headRef: 'release/server-v1.2.3',
  baseRef: 'main',
  parents: 2,
  versionAtMerge: '1.2.3',
};

describe('checkIdentity', () => {
  test('PR rilis sah: dari repositori sendiri, cabang release/server-vX.Y.Z ke main, merge commit, versi berkas sama', () => {
    expect(checkIdentity(ok)).toEqual({ ok: true, component: 'server', version: '1.2.3' });
  });

  test('versi di berkas berbeda dari versi cabang ditolak (mis. 1.2.3 vs 1.2.4)', () => {
    const result = checkIdentity({ ...ok, versionAtMerge: '1.2.4' });
    expect(result.ok).toBe(false);
  });

  test('fork ditolak (head dan base repositori berbeda)', () => {
    expect(checkIdentity({ ...ok, headRepo: 'penyerang/qc-app' }).ok).toBe(false);
  });

  test('bukan ke main ditolak', () => {
    for (const baseRef of ['dev', 'release/server-v1.2.3', '']) {
      expect(checkIdentity({ ...ok, baseRef }).ok, baseRef).toBe(false);
    }
  });

  test('bukan merge commit ditolak (squash/rebase: satu induk; atau lebih dari dua)', () => {
    for (const parents of [0, 1, 3]) {
      expect(checkIdentity({ ...ok, parents }).ok, String(parents)).toBe(false);
    }
  });

  test('nama cabang yang tidak persis release/server-v<semver> ditolak', () => {
    for (const headRef of [
      'release/server-v1.2.3-evil',
      'release/server-v01.2.3',
      'release/server-v1.2',
      'release/desktop-v1.2.3',
      'feat/release/server-v1.2.3',
      'release/server-v1.2.3/x',
      'release/server-v1.2.3 ',
      '',
    ]) {
      expect(checkIdentity({ ...ok, headRef, versionAtMerge: '1.2.3' }).ok, headRef).toBe(false);
    }
  });

  test('alasan penolakan berbahasa Indonesia dan tidak memuat nilai masukan mentah (nama cabang/repositori)', () => {
    const hostile = 'release/server-v1.2.3";echo pwned;"';
    const result = checkIdentity({ ...ok, headRef: hostile, headRepo: 'penyerang/qc-app' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain('pwned');
      expect(result.reason).not.toContain('penyerang');
      expect(result.reason.length).toBeGreaterThan(10);
    }
  });
});
