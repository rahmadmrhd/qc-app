import { describe, expect, test } from 'bun:test';
import {
  evaluateGuard,
  type GuardInput,
  lockOnlyWorkspaceVersionChanged,
  type ManifestContents,
  onlyVersionChanged,
  unverifiedFiles,
  unverifiedManifests,
} from './release-guard';

const pkg = (version: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify(
    { name: '@qc/server', version, dependencies: { hono: '^4.13.13' }, ...extra },
    null,
    2,
  );

/** Cuplikan `bun.lock` berbentuk asli: versi workspace di indentasi 6 spasi, dependensi di 8 spasi. */
const lock = (serverVersion: string, honoRange = '^4.13.13', pinned = 'hono@4.13.13'): string =>
  [
    '{',
    '  "lockfileVersion": 2,',
    '  "workspaces": {',
    '    "server": {',
    '      "name": "@qc/server",',
    `      "version": "${serverVersion}",`,
    '      "dependencies": {',
    `        "hono": "${honoRange}",`,
    '      },',
    '    },',
    '  },',
    '  "packages": {',
    `    "hono": ["${pinned}", "", {}, "sha512-AAA"],`,
    '  },',
    '}',
    '',
  ].join('\n');

/** Bukti isi manifest bahwa hanya versi yang berubah (kenaikan versi rilis). */
const MANIFESTS_OK: ManifestContents = {
  'server/package.json': { before: pkg('0.0.0'), after: pkg('1.0.0') },
  'desktop/package.json': {
    before: pkg('0.1.0', { name: '@qc/desktop' }),
    after: pkg('0.2.0', { name: '@qc/desktop' }),
  },
  'bun.lock': { before: lock('0.0.0'), after: lock('1.0.0') },
};

/** `evaluateGuard` dengan bukti manifest sah sebagai bawaan; tiap tes dapat menimpanya. */
const guard = (input: GuardInput) => evaluateGuard({ manifests: MANIFESTS_OK, ...input });

const META = [
  'server/package.json',
  'bun.lock',
  'server/CHANGELOG.md',
  'server/changelog.d/20261117-a.md',
];

describe('evaluateGuard: perbandingan terpotong', () => {
  test('300 berkas atau lebih (batas API compare; daftar terpotong diam-diam) ditolak, gagal tertutup', () => {
    for (const fileCount of [300, 301, 5000]) {
      const result = guard({
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
      guard({
        compareStatus: 'ahead',
        files: META,
        fileCount: META.length,
        changelogHasVersion: true,
      }).ok,
    ).toBe(true);
    expect(
      guard({
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
      guard({
        compareStatus: 'ahead',
        files: META,
        fileCount: 4,
        changelogHasVersion: true,
      }),
    ).toEqual({ ok: true, reason: expect.any(String) });
  });

  test('identical dengan daftar berkas kosong juga lulus', () => {
    expect(guard({ compareStatus: 'identical', files: [], changelogHasVersion: true }).ok).toBe(
      true,
    );
  });

  test('diverged atau behind ditolak (staging bukan leluhur commit rilis)', () => {
    for (const compareStatus of ['diverged', 'behind', '', 'apa-saja']) {
      const result = guard({ compareStatus, files: META, changelogHasVersion: true });
      expect(result.ok, compareStatus).toBe(false);
      expect(result.reason).toMatch(/staging/i);
    }
  });

  test('satu berkas non-metadata di antara berkas metadata ditolak dan pesannya menyebut cara pulih', () => {
    const result = guard({
      compareStatus: 'ahead',
      files: [...META, 'server/src/app.ts'],
      changelogHasVersion: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/staging/i);
    expect(result.reason).toMatch(/workflow_dispatch|jalankan ulang/i);
  });

  test('berkas desktop/package.json pada rilis server ditolak', () => {
    const result = guard({
      compareStatus: 'ahead',
      files: [...META, 'desktop/package.json'],
      changelogHasVersion: true,
    });
    expect(result.ok).toBe(false);
  });

  test('CHANGELOG tanpa bagian versi ditolak', () => {
    const result = guard({
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
    guard({
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
    expect(guard(input(BOTH_META, ['server', 'desktop'])).ok).toBe(true);
  });

  test('tanpa daftar komponen (rilis server saja) metadata desktop tetap ditolak: perilaku lama tak berubah', () => {
    expect(guard(input(BOTH_META)).ok).toBe(false);
    expect(guard(input(BOTH_META, ['server'])).ok).toBe(false);
  });

  test('kode server atau berkas lain yang masuk image ditolak walau komponen desktop ikut dirilis', () => {
    expect(guard(input([...BOTH_META, 'web/src/main.tsx'], ['server', 'desktop'])).ok).toBe(false);
    expect(guard(input([...BOTH_META, 'server/src/app.ts'], ['server', 'desktop'])).ok).toBe(false);
  });
});

describe('unverifiedFiles: potret kontrak API', () => {
  const SNAP = 'shared/api-contract.snapshot.json';
  test('potret = metadata rilis server: tak dianggap belum terverifikasi saat server dirilis', () => {
    expect(unverifiedFiles([SNAP], ['server'])).toEqual([]);
    expect(unverifiedFiles([SNAP], ['server', 'desktop'])).toEqual([]);
  });
  test('rilis desktop saja tidak melonggarkan potret', () => {
    expect(unverifiedFiles([SNAP], ['desktop'])).toEqual([SNAP]);
  });
  test('berkas kontrak lain tetap tak terverifikasi (tak ikut melonggar)', () => {
    expect(unverifiedFiles(['shared/contract.ts'], ['server'])).toEqual(['shared/contract.ts']);
  });
});

describe('manifest: package.json dan bun.lock hanya dibebaskan bila hanya versinya yang berubah', () => {
  const SERVER_META = ['server/package.json', 'bun.lock'];

  test('tanpa isi manifest, jalur server/package.json dan bun.lock saja TIDAK cukup (gagal tertutup)', () => {
    expect(unverifiedFiles(SERVER_META, ['server'])).toEqual(SERVER_META);
    const result = evaluateGuard({
      compareStatus: 'ahead',
      files: [...SERVER_META, 'server/CHANGELOG.md'],
      changelogHasVersion: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/image server/i);
  });

  test('kenaikan versi saja lulus (package.json dan entri versi workspace di bun.lock)', () => {
    expect(unverifiedFiles(SERVER_META, ['server'], MANIFESTS_OK)).toEqual([]);
    expect(unverifiedManifests(SERVER_META, ['server'], MANIFESTS_OK)).toEqual([]);
  });

  test('dependensi ikut berubah di package.json: ditolak walau versinya juga naik', () => {
    const manifests: ManifestContents = {
      ...MANIFESTS_OK,
      'server/package.json': {
        before: pkg('0.0.0'),
        after: pkg('1.0.0', { dependencies: { hono: '^4.13.13', 'paket-jahat': '1.0.0' } }),
      },
    };
    expect(unverifiedFiles(['server/package.json'], ['server'], manifests)).toEqual([
      'server/package.json',
    ]);
  });

  test('skrip, field lain, atau JSON rusak di package.json: ditolak', () => {
    for (const after of [
      pkg('1.0.0', { scripts: { postinstall: 'curl x | sh' } }),
      pkg('1.0.0', { name: '@qc/lain' }),
      '{ bukan json',
    ]) {
      expect(onlyVersionChanged(pkg('0.0.0'), after), after).toBe(false);
    }
    expect(onlyVersionChanged(pkg('0.0.0'), pkg('9.9.9'))).toBe(true);
  });

  test('bun.lock: perubahan rentang dependensi, paket terkunci, atau format tak dikenal ditolak', () => {
    expect(lockOnlyWorkspaceVersionChanged(lock('0.0.0'), lock('1.0.0'))).toBe(true);
    expect(lockOnlyWorkspaceVersionChanged(lock('0.0.0'), lock('1.0.0', '^5.0.0'))).toBe(false);
    expect(
      lockOnlyWorkspaceVersionChanged(lock('0.0.0'), lock('1.0.0', '^4.13.13', 'hono@5.0.0')),
    ).toBe(false);
    expect(lockOnlyWorkspaceVersionChanged('bukan lockfile', 'bukan lockfile lain')).toBe(false);
    const manifests: ManifestContents = {
      ...MANIFESTS_OK,
      'bun.lock': { before: lock('0.0.0'), after: lock('1.0.0', '^5.0.0') },
    };
    expect(unverifiedFiles(['bun.lock'], ['server'], manifests)).toEqual(['bun.lock']);
  });

  test('berkas manifest hilang di satu sisi atau tak diberikan: ditolak; isi identik: lulus', () => {
    const missing: ManifestContents = {
      'bun.lock': { before: null, after: lock('1.0.0') },
    };
    expect(unverifiedManifests(['bun.lock'], ['server'], missing)).toEqual(['bun.lock']);
    expect(unverifiedManifests(['bun.lock'], ['server'], {})).toEqual(['bun.lock']);
    const same: ManifestContents = { 'bun.lock': { before: lock('1.0.0'), after: lock('1.0.0') } };
    expect(unverifiedManifests(['bun.lock'], ['server'], same)).toEqual([]);
  });

  test('package.json akar dan server/package.json pada rilis desktop saja tetap tak dibebaskan', () => {
    expect(unverifiedFiles(['package.json'], ['server'], MANIFESTS_OK)).toEqual(['package.json']);
    expect(unverifiedFiles(['server/src/app.ts'], ['server'], MANIFESTS_OK)).toEqual([
      'server/src/app.ts',
    ]);
    // Komponen desktop saja: server/package.json bukan metadatanya lagi.
    expect(unverifiedFiles(['server/package.json'], ['desktop'], MANIFESTS_OK)).toEqual([
      'server/package.json',
    ]);
  });

  test('evaluateGuard: perubahan dependensi yang menyamar sebagai metadata rilis ditolak', () => {
    const result = evaluateGuard({
      compareStatus: 'ahead',
      files: [...SERVER_META, 'server/CHANGELOG.md'],
      changelogHasVersion: true,
      manifests: {
        ...MANIFESTS_OK,
        'bun.lock': { before: lock('0.0.0'), after: lock('1.0.0', '^4.13.13', 'hono@4.99.0') },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('bun.lock');
  });
});
