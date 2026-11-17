import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_CHANGES, type Changes, classify, formatOutputs, MAX_FILES } from './ci-changes';
import { ROOT_DIR } from './paths';

const NONE: Changes = {
  code: false,
  server_tests: false,
  web_tests: false,
  shared_tests: false,
  desktop_tests: false,
  desktop_pack: false,
  image: false,
};
const only = (...keys: (keyof Changes)[]): Changes => {
  const result = { ...NONE };
  for (const key of keys) result[key] = true;
  return result;
};

describe('classify: satu bagian monorepo', () => {
  test('docs saja (docs/, *.md, .superpowers/, .claude/) tidak menyalakan apa pun', () => {
    expect(
      classify(['docs/x.md', 'README.md', '.superpowers/a', '.claude/b', 'web/README.md']),
    ).toEqual(NONE);
  });

  test('server saja: code, server_tests, image', () => {
    expect(classify(['server/src/app.ts'])).toEqual(only('code', 'server_tests', 'image'));
  });

  test('web saja: code, web_tests, desktop_pack, image', () => {
    expect(classify(['web/src/main.tsx'])).toEqual(
      only('code', 'web_tests', 'desktop_pack', 'image'),
    );
  });

  test('desktop saja: tanpa image dan tanpa tes server', () => {
    const result = classify(['desktop/src/main/index.ts']);
    expect(result).toEqual(only('code', 'desktop_tests', 'desktop_pack'));
    expect(result.image).toBe(false);
    expect(result.server_tests).toBe(false);
  });

  test('shared: server, web, shared, desktop_pack, image; desktop_tests tidak', () => {
    expect(classify(['shared/contract.ts'])).toEqual(
      only('code', 'server_tests', 'web_tests', 'shared_tests', 'desktop_pack', 'image'),
    );
  });

  test('countrylock: web_tests, desktop_tests, desktop_pack, image; server_tests tidak', () => {
    expect(classify(['countrylock/src/config.ts'])).toEqual(
      only('code', 'web_tests', 'desktop_tests', 'desktop_pack', 'image'),
    );
  });

  test('deploy saja: code dan server_tests (tes deploy-files ada di server), tanpa image', () => {
    expect(classify(['deploy/compose.yml'])).toEqual(only('code', 'server_tests'));
  });

  test('campuran web + desktop = gabungan (OR)', () => {
    expect(classify(['web/src/a.ts', 'desktop/src/b.ts'])).toEqual(
      only('code', 'web_tests', 'desktop_tests', 'desktop_pack', 'image'),
    );
  });

  test('docs bersama kode tidak mematikan kode', () => {
    expect(classify(['docs/a.md', 'server/src/a.ts'])).toEqual(
      only('code', 'server_tests', 'image'),
    );
  });
});

describe('classify: infra, tak dikenal, dan kasus aman', () => {
  test('jalur infra atau tak dikenal menyalakan semua', () => {
    for (const path of [
      '.github/workflows/x.yml',
      'bun.lock',
      'package.json',
      'scripts/a.ts',
      'biome.json',
      'tsconfig.base.json',
      'Dockerfile',
      'folder-baru/a.ts',
    ]) {
      expect(classify([path]), path).toEqual(ALL_CHANGES);
    }
  });

  test('daftar kosong, null, dan hanya baris kosong = semua true (fail-safe)', () => {
    expect(classify([])).toEqual(ALL_CHANGES);
    expect(classify(null)).toEqual(ALL_CHANGES);
    expect(classify(['', '  ', '\r'])).toEqual(ALL_CHANGES);
  });

  test('lebih dari MAX_FILES jalur = semua true walau semuanya docs', () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) => `docs/f${i}.md`);
    expect(classify(files)).toEqual(ALL_CHANGES);
    expect(classify(files.slice(0, MAX_FILES))).toEqual(NONE);
  });

  test('jalur Windows dan akhiran CR dinormalkan', () => {
    expect(classify(['web\\src\\a.ts'])).toEqual(classify(['web/src/a.ts']));
    expect(classify(['web/src/a.ts\r'])).toEqual(classify(['web/src/a.ts']));
    expect(classify(['./server/src/a.ts'])).toEqual(classify(['server/src/a.ts']));
  });

  test('rename lintas folder (nama lama dan baru) menyalakan kedua bagian', () => {
    expect(classify(['desktop/a.ts', 'server/a.ts'])).toEqual(
      only('code', 'desktop_tests', 'desktop_pack', 'server_tests', 'image'),
    );
  });

  test('tiap workspace di package.json akar menyalakan code (workspace baru tak dianggap dokumen)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')) as {
      workspaces: string[];
    };
    expect(pkg.workspaces.length).toBeGreaterThan(0);
    for (const workspace of pkg.workspaces) {
      expect(classify([`${workspace}/x.ts`]).code, workspace).toBe(true);
    }
  });
});

describe('formatOutputs dan CLI', () => {
  test('formatOutputs: tujuh baris berurut, true/false huruf kecil, akhiran newline', () => {
    expect(formatOutputs(only('code', 'image'))).toBe(
      [
        'code=true',
        'server_tests=false',
        'web_tests=false',
        'shared_tests=false',
        'desktop_tests=false',
        'desktop_pack=false',
        'image=true',
        '',
      ].join('\n'),
    );
  });

  test('CLI membaca stdin dan menulis ke GITHUB_OUTPUT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-ci-changes-'));
    try {
      const out = join(dir, 'output');
      writeFileSync(out, '');
      const proc = Bun.spawn(
        [process.execPath, 'run', join(ROOT_DIR, 'scripts', 'ci-changes.ts')],
        {
          env: { ...process.env, GITHUB_OUTPUT: out },
          stdin: new Blob(['web/a.ts\n']),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(await proc.exited).toBe(0);
      const written = readFileSync(out, 'utf8');
      expect(written).toContain('image=true');
      expect(written).toContain('server_tests=false');
      expect(await new Response(proc.stdout).text()).toContain('web_tests=true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
