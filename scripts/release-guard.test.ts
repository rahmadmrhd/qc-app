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

describe('evaluateGuard: berkas di luar image server tak membuat guard menolak', () => {
  // Celah lama: PR ke dev yang hanya mengubah desktop/ atau dokumentasi tak men-deploy staging, sehingga
  // `refs/deployed/staging` tertinggal dan guard menolak rilis walau isi image server tak berubah (keputusan pemilik 2026-11-19).
  const withExtra = (extra: string[], components?: Array<'server' | 'desktop'>) =>
    evaluateGuard({
      compareStatus: 'ahead',
      files: [...META, ...extra],
      fileCount: META.length + extra.length,
      changelogHasVersion: true,
      ...(components ? { components } : {}),
    });

  test('kode desktop, dokumentasi, dan berkas .md lain lulus: tak masuk image server', () => {
    expect(withExtra(['desktop/src/main/index.ts']).ok).toBe(true);
    expect(withExtra(['docs/ci-cd.md', 'docs/superpowers/specs/x.md', 'README.md']).ok).toBe(true);
    expect(withExtra(['desktop/CHANGELOG.md', 'desktop/changelog.d/20261119-a.md']).ok).toBe(true);
  });

  test('berkas yang masuk image tetap ditolak: server, shared, web, countrylock, scripts, desktop/package.json, bun.lock tak dikenal', () => {
    for (const path of [
      'server/src/app.ts',
      'server/migrations/0024_x.sql',
      'shared/api.ts',
      'web/src/main.tsx',
      'countrylock/src/config.ts',
      'scripts/restore-backup.ts',
      'desktop/package.json',
      'Dockerfile',
      '.dockerignore',
      'tsconfig.base.json',
    ]) {
      expect(withExtra([path]).ok, path).toBe(false);
    }
  });

  test('.md berhuruf besar atau berspasi ujung tetap masuk konteks Docker (.dockerignore peka huruf): ditolak', () => {
    for (const path of [
      'web/public/x.MD',
      'server/src/x.Md',
      'scripts/x.MD',
      'web/public/a.md ',
      'server/migrations/x.md	',
    ]) {
      expect(withExtra([path]).ok, JSON.stringify(path)).toBe(false);
    }
  });

  test('jalur tak dikenal (aksi lokal, folder baru, berkas akar baru) ditolak: gagal tertutup', () => {
    for (const path of ['.github/actions/setup/action.yml', 'brand-baru/x.ts', 'catatan.txt']) {
      expect(withExtra([path]).ok, path).toBe(false);
    }
  });

  test('perubahan .github/workflows/ diloloskan: tak masuk image (keputusan pemilik 2026-11-20)', () => {
    for (const path of ['.github/workflows/deploy-server.yml', '.github/workflows/release.yml']) {
      expect(withExtra([path]).ok, path).toBe(true);
    }
  });

  test('satu berkas image di antara berkas non-image tetap menolak', () => {
    expect(withExtra(['docs/a.md', 'desktop/src/a.ts', 'server/src/app.ts']).ok).toBe(false);
  });

  test('pada rilis gabungan, kode desktop lulus karena diperiksa ci penuh (desktop-check), bukan staging', () => {
    expect(withExtra(['desktop/src/main/index.ts'], ['server', 'desktop']).ok).toBe(true);
  });

  test('pesan penolakan menyebut berkas penahan (maks. 5, sisanya dihitung) dan cara pulih', () => {
    const result = withExtra(['server/src/app.ts']);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/image server/i);
    expect(result.reason).toContain('server/src/app.ts');
    expect(result.reason).toMatch(/workflow_dispatch|jalankan ulang/i);
    const many = withExtra(Array.from({ length: 8 }, (_, i) => `web/src/f${i}.ts`));
    expect(many.reason).toContain('web/src/f0.ts');
    expect(many.reason).not.toContain('web/src/f7.ts');
    expect(many.reason).toMatch(/\+3 lagi/);
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

  test('kode server atau berkas lain yang masuk image ditolak walau komponen desktop ikut dirilis', () => {
    expect(evaluateGuard(input([...BOTH_META, 'web/src/main.tsx'], ['server', 'desktop'])).ok).toBe(
      false,
    );
    expect(
      evaluateGuard(input([...BOTH_META, 'server/src/app.ts'], ['server', 'desktop'])).ok,
    ).toBe(false);
  });
});
