import { describe, expect, test } from 'bun:test';
import {
  checkIdentity,
  type IdentityInput,
  parseOnly,
  parseReleaseRef,
  releaseComponents,
  releaseOutputs,
} from './release-identity';

const ok: IdentityInput = {
  baseRepo: 'pemilik/qc-app',
  headRepo: 'pemilik/qc-app',
  headRef: 'release/server-v1.2.3',
  baseRef: 'main',
  parents: 2,
  versionsAtMerge: { server: '1.2.3', desktop: '0.0.0' },
  releaseFlow: 'tag',
};
const desktop: IdentityInput = {
  ...ok,
  headRef: 'release/desktop-v4.5.6',
  versionsAtMerge: { server: '1.2.3', desktop: '4.5.6' },
};
const both: IdentityInput = {
  ...ok,
  headRef: 'release/gabungan-server-v1.2.3-desktop-v4.5.6',
  versionsAtMerge: { server: '1.2.3', desktop: '4.5.6' },
};

describe('parseReleaseRef', () => {
  test('tiga bentuk cabang rilis yang sah', () => {
    expect(parseReleaseRef('release/server-v1.2.3')).toEqual({ server: '1.2.3' });
    expect(parseReleaseRef('release/desktop-v4.5.6')).toEqual({ desktop: '4.5.6' });
    expect(parseReleaseRef('release/gabungan-server-v1.2.3-desktop-v4.5.6')).toEqual({
      server: '1.2.3',
      desktop: '4.5.6',
    });
  });

  test('bentuk lain ditolak (null): awalan nol, akhiran, urutan terbalik, satu sisi gabungan, spasi, baris baru', () => {
    for (const ref of [
      'release/server-v01.2.3',
      'release/server-v1.2',
      'release/server-v1.2.3-evil',
      'release/server-v1.2.3/x',
      'release/server-v1.2.3 ',
      'release/server-v1.2.3\n',
      'feat/release/server-v1.2.3',
      'release/gabungan-desktop-v4.5.6-server-v1.2.3',
      'release/gabungan-server-v1.2.3',
      'release/gabungan-desktop-v4.5.6',
      'release/gabungan-server-v1.2.3-desktop-v04.5.6',
      'release/gabungan-server-v1.2.3-desktop-v4.5.6-x',
      'release/gabungan-server-v1.2.3-server-v1.2.4',
      'release/gabungan-server-v1.2.3-desktop-v4.5.6\n',
      'release/gabungan-',
      'release/semua-v1.2.3',
      '',
    ]) {
      expect(parseReleaseRef(ref), JSON.stringify(ref)).toBeNull();
    }
  });
});

describe('checkIdentity', () => {
  test('PR rilis server sah: repositori sendiri, cabang ke main, merge commit, versi berkas sama', () => {
    expect(checkIdentity(ok)).toEqual({ ok: true, versions: { server: '1.2.3' } });
  });

  test('PR rilis desktop sah mengembalikan hanya komponen desktop', () => {
    expect(checkIdentity(desktop)).toEqual({ ok: true, versions: { desktop: '4.5.6' } });
  });

  test('PR gabungan sah mengembalikan kedua komponen', () => {
    expect(checkIdentity(both)).toEqual({
      ok: true,
      versions: { server: '1.2.3', desktop: '4.5.6' },
    });
  });

  test('versi berkas berbeda dari versi cabang ditolak, untuk SETIAP komponen yang disebut cabang', () => {
    expect(checkIdentity({ ...ok, versionsAtMerge: { server: '1.2.4' } }).ok).toBe(false);
    expect(checkIdentity({ ...desktop, versionsAtMerge: { desktop: '4.5.7' } }).ok).toBe(false);
    expect(
      checkIdentity({ ...both, versionsAtMerge: { server: '1.2.3', desktop: '4.5.7' } }).ok,
    ).toBe(false);
    expect(
      checkIdentity({ ...both, versionsAtMerge: { server: '1.2.4', desktop: '4.5.6' } }).ok,
    ).toBe(false);
    expect(checkIdentity({ ...both, versionsAtMerge: { server: '1.2.3' } }).ok).toBe(false);
    expect(checkIdentity({ ...ok, versionsAtMerge: {} }).ok).toBe(false);
  });

  test('versi komponen yang TIDAK disebut cabang tidak diperiksa (berkas boleh berisi versi lain)', () => {
    expect(
      checkIdentity({ ...ok, versionsAtMerge: { server: '1.2.3', desktop: '9.9.9' } }).ok,
    ).toBe(true);
  });

  test('fork, bukan ke main, dan bukan merge commit ditolak untuk semua bentuk cabang', () => {
    for (const input of [ok, desktop, both]) {
      expect(checkIdentity({ ...input, headRepo: 'penyerang/qc-app' }).ok).toBe(false);
      expect(checkIdentity({ ...input, baseRepo: '', headRepo: '' }).ok).toBe(false);
      for (const baseRef of ['dev', 'release/server-v1.2.3', '']) {
        expect(checkIdentity({ ...input, baseRef }).ok, baseRef).toBe(false);
      }
      for (const parents of [0, 1, 3]) {
        expect(checkIdentity({ ...input, parents }).ok, String(parents)).toBe(false);
      }
    }
  });

  test('nama cabang yang bukan bentuk rilis sah ditolak', () => {
    for (const headRef of [
      'release/server-v1.2.3-evil',
      'release/server-v01.2.3',
      'release/server-v1.2',
      'feat/release/server-v1.2.3',
      'release/server-v1.2.3/x',
      'release/server-v1.2.3 ',
      'release/gabungan-server-v1.2.3',
      'release/gabungan-desktop-v4.5.6-server-v1.2.3',
      '',
    ]) {
      expect(checkIdentity({ ...ok, headRef }).ok, headRef).toBe(false);
    }
  });

  test('only membatasi hasil ke satu komponen (pemulihan); komponen di luar cabang ditolak', () => {
    expect(checkIdentity({ ...both, only: 'server' })).toEqual({
      ok: true,
      versions: { server: '1.2.3' },
    });
    expect(checkIdentity({ ...both, only: 'desktop' })).toEqual({
      ok: true,
      versions: { desktop: '4.5.6' },
    });
    expect(checkIdentity({ ...ok, only: 'server' })).toEqual({
      ok: true,
      versions: { server: '1.2.3' },
    });
    expect(checkIdentity({ ...ok, only: 'desktop' }).ok).toBe(false);
    expect(checkIdentity({ ...desktop, only: 'server' }).ok).toBe(false);
  });

  test('only tetap tunduk pada pemeriksaan versi komponen yang dipilih, dan komponen lain tak mengganggu', () => {
    expect(
      checkIdentity({
        ...both,
        only: 'server',
        versionsAtMerge: { server: '1.2.4', desktop: '4.5.6' },
      }).ok,
    ).toBe(false);
    expect(
      checkIdentity({
        ...both,
        only: 'server',
        versionsAtMerge: { server: '1.2.3', desktop: '0.0.1' },
      }).ok,
    ).toBe(false); // cabang gabungan menyebut desktop: versinya tetap harus cocok walau hanya server yang dipulihkan
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
    const bothBad = checkIdentity({
      ...both,
      versionsAtMerge: { server: '1.2.3', desktop: '6.6.6-pwned' },
    });
    expect(bothBad.ok).toBe(false);
    if (!bothBad.ok) expect(bothBad.reason).not.toContain('pwned');
  });
});

describe('rilis gabungan hanya sah saat RELEASE_FLOW = tag', () => {
  test('bukan tag (kosong, langsung, tak diberikan) menolak cabang gabungan, juga untuk pemulihan satu komponen; tunggal tak terpengaruh', () => {
    for (const releaseFlow of ['', 'langsung', 'TAG', undefined]) {
      expect(checkIdentity({ ...both, releaseFlow }).ok, String(releaseFlow)).toBe(false);
      expect(checkIdentity({ ...both, releaseFlow, only: 'desktop' }).ok, String(releaseFlow)).toBe(
        false,
      );
      expect(checkIdentity({ ...desktop, releaseFlow }).ok, String(releaseFlow)).toBe(true);
      expect(checkIdentity({ ...ok, releaseFlow }).ok, String(releaseFlow)).toBe(true);
    }
    expect(checkIdentity(both).ok).toBe(true);
  });
});

describe('parseOnly (komponen pemulihan)', () => {
  test('kosong = tanpa pembatasan; server atau desktop sah; nilai lain ditolak (gagal tertutup)', () => {
    expect(parseOnly(undefined)).toEqual({ ok: true, only: undefined });
    expect(parseOnly('')).toEqual({ ok: true, only: undefined });
    expect(parseOnly('server')).toEqual({ ok: true, only: 'server' });
    expect(parseOnly('desktop')).toEqual({ ok: true, only: 'desktop' });
    for (const value of ['Server', 'semua', 'server,desktop', ' server', 'server\n']) {
      expect(parseOnly(value).ok, value).toBe(false);
    }
  });
});

describe('releaseComponents (komponen yang dimuat cabang, terlepas dari `only`)', () => {
  test('server, desktop, atau keduanya menurut bentuk cabang; bukan cabang rilis = kosong', () => {
    expect(releaseComponents('release/server-v1.2.3')).toBe('server');
    expect(releaseComponents('release/desktop-v4.5.6')).toBe('desktop');
    expect(releaseComponents('release/gabungan-server-v1.2.3-desktop-v4.5.6')).toBe(
      'server,desktop',
    );
    expect(releaseComponents('release/server-v1.2.3-evil')).toBe('');
    expect(releaseComponents('')).toBe('');
  });
});

describe('releaseOutputs (saklar RELEASE_FLOW)', () => {
  test('server hanya dirilis bila RELEASE_FLOW = tag; desktop tak bergantung pada saklar', () => {
    expect(releaseOutputs({ server: '1.2.3', desktop: '4.5.6' }, 'tag')).toEqual({
      release: true,
      server: '1.2.3',
      desktop: '4.5.6',
    });
    expect(releaseOutputs({ server: '1.2.3', desktop: '4.5.6' }, 'langsung')).toEqual({
      release: true,
      server: '',
      desktop: '4.5.6',
    });
    expect(releaseOutputs({ server: '1.2.3' }, '')).toEqual({
      release: false,
      server: '',
      desktop: '',
    });
    expect(releaseOutputs({ server: '1.2.3' }, 'tag')).toEqual({
      release: true,
      server: '1.2.3',
      desktop: '',
    });
    expect(releaseOutputs({ desktop: '4.5.6' }, undefined)).toEqual({
      release: true,
      server: '',
      desktop: '4.5.6',
    });
  });
});
