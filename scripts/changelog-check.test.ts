import { describe, expect, test } from 'bun:test';
import {
  checkChangelog,
  isFragmentPath,
  isMetadataOnly,
  isReleaseChange,
  LABEL_SKIP,
  requiredComponents,
} from './changelog-check';

describe('requiredComponents', () => {
  test('server/, web/, shared/, countrylock/ mewajibkan fragmen server; desktop/ hanya desktop', () => {
    expect(requiredComponents(['web/src/x.ts'])).toEqual(['server']);
    expect(requiredComponents(['server/src/app.ts'])).toEqual(['server']);
    expect(requiredComponents(['desktop/src/main/index.ts'])).toEqual(['desktop']);
  });

  test('shared/ dan countrylock/ mewajibkan KEDUANYA (web memakai countrylock, desktop memakai shared)', () => {
    expect(requiredComponents(['shared/a.ts'])).toEqual(['server', 'desktop']);
    expect(requiredComponents(['countrylock/src/a.ts'])).toEqual(['server', 'desktop']);
  });

  test('dokumentasi, CI, skrip, deploy, berkas akar, CHANGELOG, dan fragmen tidak dihitung', () => {
    expect(
      requiredComponents([
        'docs/a.md',
        '.github/workflows/x.yml',
        'scripts/x.ts',
        'deploy/deploy.sh',
        'README.md',
        'package.json',
        'bun.lock',
        'server/CHANGELOG.md',
        'desktop/CHANGELOG.md',
        'server/changelog.d/20261117-a.md',
        'desktop/changelog.d/.gitkeep',
        'web/README.md',
      ]),
    ).toEqual([]);
  });

  test('gabungan tanpa duplikat; urutan server lalu desktop; jalur Windows dinormalkan', () => {
    expect(requiredComponents(['web/a.ts', 'desktop\\b.ts', 'shared/c.ts'])).toEqual([
      'server',
      'desktop',
    ]);
  });
});

describe('isReleaseChange', () => {
  const metadata = [
    'server/package.json',
    'bun.lock',
    'server/CHANGELOG.md',
    'server/changelog.d/20261117-a.md',
  ];

  test('semua berkas metadata komponen = PR rilis; satu berkas lain membatalkannya', () => {
    expect(isReleaseChange(metadata, 'server')).toBe(true);
    expect(isReleaseChange([...metadata, 'server/src/app.ts'], 'server')).toBe(false);
    expect(isReleaseChange([...metadata, 'README.md'], 'server')).toBe(false);
  });

  test('metadata komponen lain tidak dihitung bila komponen disebut; tanpa komponen = metadata keduanya', () => {
    const desktop = ['desktop/package.json', 'bun.lock', 'desktop/CHANGELOG.md'];
    expect(isReleaseChange(desktop, 'server')).toBe(false);
    expect(isReleaseChange(desktop, 'desktop')).toBe(true);
    expect(isReleaseChange([...desktop, 'server/package.json', 'server/CHANGELOG.md'])).toBe(true);
  });

  test('wajib memuat CHANGELOG.md komponen: kenaikan dependensi (package.json + bun.lock saja) bukan rilis', () => {
    expect(isReleaseChange(['server/package.json', 'bun.lock'], 'server')).toBe(false);
    expect(isReleaseChange(['server/package.json', 'bun.lock'])).toBe(false);
    expect(isReleaseChange(['server/CHANGELOG.md'], 'server')).toBe(true);
  });

  test('daftar kosong bukan PR rilis', () => {
    expect(isReleaseChange([])).toBe(false);
    expect(isReleaseChange([], 'server')).toBe(false);
  });
});

describe('isMetadataOnly', () => {
  test('daftar kosong atau semua berkas metadata komponen = true; satu berkas lain = false', () => {
    expect(isMetadataOnly([], 'server')).toBe(true);
    expect(isMetadataOnly(['server/changelog.d/20261117-a.md'], 'server')).toBe(true);
    expect(isMetadataOnly(['server/package.json', 'bun.lock'], 'server')).toBe(true);
    expect(isMetadataOnly(['server/changelog.d/20261117-a.md', 'web/a.ts'], 'server')).toBe(false);
    expect(isMetadataOnly(['desktop/CHANGELOG.md'], 'server')).toBe(false);
  });
});

describe('isFragmentPath', () => {
  test('hanya <server|desktop>/changelog.d/<berkas>.md', () => {
    expect(isFragmentPath('server/changelog.d/20261117-a.md')).toBe(true);
    expect(isFragmentPath('desktop/changelog.d/20261117-a.md')).toBe(true);
    expect(isFragmentPath('server/changelog.d/.gitkeep')).toBe(false);
    expect(isFragmentPath('web/changelog.d/20261117-a.md')).toBe(false);
    expect(isFragmentPath('server/changelog.d/sub/a.md')).toBe(false);
  });
});

describe('checkChangelog', () => {
  const none: string[] = [];

  test('server berubah tanpa fragmen baru dan tanpa label = gagal, menyebut komponen yang kurang', () => {
    expect(checkChangelog({ files: ['web/a.ts'], addedFragments: none, labels: none })).toEqual({
      ok: false,
      missing: ['server'],
    });
  });

  test('fragmen server cukup untuk server; shared tetap butuh fragmen desktop juga', () => {
    const added = ['server/changelog.d/20261117-a.md'];
    expect(checkChangelog({ files: ['web/a.ts'], addedFragments: added, labels: none }).ok).toBe(
      true,
    );
    expect(checkChangelog({ files: ['shared/a.ts'], addedFragments: added, labels: none })).toEqual(
      {
        ok: false,
        missing: ['desktop'],
      },
    );
  });

  test(`label ${LABEL_SKIP} melewatkan pemeriksaan`, () => {
    expect(
      checkChangelog({ files: ['web/a.ts'], addedFragments: none, labels: [LABEL_SKIP] }).ok,
    ).toBe(true);
    expect(checkChangelog({ files: ['web/a.ts'], addedFragments: none, labels: ['lain'] }).ok).toBe(
      false,
    );
  });

  test('PR hanya dokumentasi atau CI tidak butuh fragmen', () => {
    expect(
      checkChangelog({ files: ['docs/a.md', '.github/x.yml'], addedFragments: none, labels: none })
        .ok,
    ).toBe(true);
  });

  test('PR rilis (hanya berkas metadata) lulus tanpa fragmen baru', () => {
    expect(
      checkChangelog({
        files: [
          'server/package.json',
          'bun.lock',
          'server/CHANGELOG.md',
          'server/changelog.d/20261117-a.md',
        ],
        addedFragments: none,
        labels: none,
      }).ok,
    ).toBe(true);
  });

  test('PR rilis NYATA (release/... -> main membawa seluruh kode dev + metadata; fragmennya sudah terhapus compile) lulus', () => {
    const files = [
      'server/src/app.ts',
      'web/src/x.tsx',
      'server/package.json',
      'bun.lock',
      'server/CHANGELOG.md',
    ];
    expect(checkChangelog({ files, addedFragments: none, labels: none })).toEqual({
      ok: true,
      missing: [],
    });
  });

  test('rilis hanya membebaskan komponennya sendiri: rilis server tidak membebaskan perubahan desktop', () => {
    const files = ['desktop/src/a.ts', 'server/package.json', 'bun.lock', 'server/CHANGELOG.md'];
    expect(checkChangelog({ files, addedFragments: none, labels: none })).toEqual({
      ok: false,
      missing: ['desktop'],
    });
  });

  test('CHANGELOG.md saja (tanpa package.json) atau package.json + bun.lock saja tidak membebaskan perubahan kode', () => {
    expect(
      checkChangelog({
        files: ['web/a.ts', 'server/CHANGELOG.md'],
        addedFragments: none,
        labels: none,
      }).ok,
    ).toBe(false);
    expect(
      checkChangelog({
        files: ['web/a.ts', 'server/package.json', 'bun.lock'],
        addedFragments: none,
        labels: none,
      }).ok,
    ).toBe(false);
  });

  test('tanda tangan fungsi tidak menerima nama cabang (cabang tak pernah dipakai melewatkan pemeriksaan)', () => {
    expect(checkChangelog.length).toBe(1);
    expect(Object.keys({ files: [], addedFragments: [], labels: [] })).toEqual([
      'files',
      'addedFragments',
      'labels',
    ]);
  });
});
