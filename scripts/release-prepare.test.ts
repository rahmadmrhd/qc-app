import { describe, expect, test } from 'bun:test';
import type { CliDeps } from './changelog';
import { nextVersion, parseArgs, prepareRelease, type Shell, wibDate } from './release-prepare';

describe('nextVersion', () => {
  test('versi eksplisit pertama: 0.0.0 tanpa tag -> 1.0.0', () => {
    expect(nextVersion('0.0.0', '1.0.0', null)).toBe('1.0.0');
  });

  test('patch/minor/major menaikkan numerik dan mereset angka bawah (1.9.0 -> minor = 1.10.0)', () => {
    expect(nextVersion('1.9.0', 'minor', 'server-v1.9.0')).toBe('1.10.0');
    expect(nextVersion('1.2.3', 'patch', 'server-v1.2.3')).toBe('1.2.4');
    expect(nextVersion('1.2.3', 'major', 'server-v1.2.3')).toBe('2.0.0');
    expect(nextVersion('1.2.3', 'minor', 'server-v1.2.3')).toBe('1.3.0');
  });

  test('versi eksplisit harus lebih besar dari tag terakhir dan dari versi berkas', () => {
    expect(() => nextVersion('1.2.0', '1.0.0', 'server-v1.2.0')).toThrow();
    expect(() => nextVersion('1.2.0', '1.2.0', 'server-v1.2.0')).toThrow();
    expect(() => nextVersion('0.0.0', '1.0.0', 'server-v1.2.0')).toThrow();
    expect(() => nextVersion('1.2.0', '1.10.0', 'server-v1.9.0')).not.toThrow();
  });

  test('masukan bukan semver atau kata kenaikan tak dikenal ditolak', () => {
    for (const bad of ['', 'v1.0.0', '1.0', 'besar', 'PATCH', '01.0.0']) {
      expect(() => nextVersion('1.0.0', bad, null)).toThrow();
    }
  });

  test('bump patch/minor/major dihitung dari versi tertinggi antara berkas dan tag', () => {
    expect(nextVersion('1.0.0', 'patch', 'server-v1.4.0')).toBe('1.4.1');
  });
});

describe('wibDate', () => {
  test('tanggal WIB (UTC+7): 17:00 UTC sudah hari berikutnya', () => {
    expect(wibDate(new Date('2026-11-17T17:30:00Z'))).toBe('2026-11-18');
    expect(wibDate(new Date('2026-11-17T16:59:59Z'))).toBe('2026-11-17');
    expect(wibDate(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
  });
});

interface Result {
  code: number;
  out: string;
}

const DEV = 'd'.repeat(40);
const STAGING = 's'.repeat(40);

/** Shell palsu: merekam semua perintah; `overrides` menimpa jawaban per perintah (kunci = argumen digabung spasi). */
function fakeShell(overrides: Record<string, Result | Result[]> = {}): Shell & { calls: string[] } {
  const calls: string[] = [];
  const defaults: Record<string, Result> = {
    'git status --porcelain': { code: 0, out: '' },
    'gh variable get RELEASE_FLOW': { code: 0, out: 'tag\n' },
    'git rev-parse --abbrev-ref HEAD': { code: 0, out: 'feat/kerja\n' },
    'git merge-base --is-ancestor origin/main origin/dev': { code: 0, out: '' },
    'git rev-parse origin/dev': { code: 0, out: `${DEV}\n` },
    'git rev-parse refs/remotes/deployed/staging': { code: 0, out: `${STAGING}\n` },
    [`git merge-base --is-ancestor ${STAGING} ${DEV}`]: { code: 0, out: '' },
    [`git diff --name-only ${STAGING} origin/dev`]: {
      code: 0,
      out: 'server/changelog.d/20261117-a.md\n',
    },
    'git ls-tree --name-only origin/dev -- server/changelog.d/': {
      code: 0,
      out: 'server/changelog.d/20261117-a.md\n',
    },
    'git tag --list server-v*': { code: 0, out: '' },
    'git show origin/dev:server/package.json': {
      code: 0,
      out: '{\n  "name": "@qc/server",\n  "version": "0.0.0"\n}\n',
    },
    'git ls-remote --heads origin release/server-v1.0.0': { code: 0, out: '' },
    'git rev-parse --verify --quiet refs/heads/release/server-v1.0.0': { code: 1, out: '' },
    'git diff --cached --name-only': {
      code: 0,
      out: 'server/package.json\nbun.lock\nserver/CHANGELOG.md\nserver/changelog.d/20261117-a.md\n',
    },
    'gh pr create': { code: 0, out: 'https://github.com/o/r/pull/9\n' },
  };
  return {
    calls,
    async run(cmd) {
      const key = cmd.join(' ');
      calls.push(key);
      const override =
        overrides[key] ?? (key.startsWith('gh pr create') ? overrides['gh pr create'] : undefined);
      const picked = Array.isArray(override)
        ? override.length > 1
          ? override.shift()
          : override[0]
        : override;
      const found =
        picked ??
        defaults[key] ??
        (key.startsWith('gh pr create') ? defaults['gh pr create'] : undefined);
      return found ?? { code: 0, out: '' };
    },
  };
}

const MUTATING = /^(git switch|git branch -D|git add|git commit|git push|gh pr create|bun install)/;
const mutating = (shell: { calls: string[] }) => shell.calls.filter((c) => MUTATING.test(c));

function fakeFiles(initial: Record<string, string>): CliDeps & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    listDir: (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => p.slice(dir.length + 1)),
    readFile: (p) => {
      const v = files[p];
      if (v === undefined) throw new Error(`tak ada: ${p}`);
      return v;
    },
    writeFile: (p, c) => {
      files[p] = c;
    },
    removeFile: (p) => {
      delete files[p];
    },
    print: () => {},
  };
}

const baseFiles = () => ({
  'server/package.json': '{\n  "name": "@qc/server",\n  "version": "0.0.0"\n}\n',
  'server/CHANGELOG.md': '# Changelog server\n',
  'server/changelog.d/20261117-a.md': 'jenis: ditambah\nFitur A.',
});

const NOW = new Date('2026-11-17T17:30:00Z');

describe('prepareRelease: prasyarat (berhenti SEBELUM membuat cabang)', () => {
  const run = (shell: Shell, files = fakeFiles(baseFiles()), bump = '1.0.0') =>
    prepareRelease({ component: 'server', bump, shell, files, now: NOW });

  test('pohon kerja kotor', async () => {
    const shell = fakeShell({ 'git status --porcelain': { code: 0, out: ' M a.ts\n' } });
    await expect(run(shell)).rejects.toThrow(/kotor|bersih/i);
    expect(mutating(shell)).toEqual([]);
  });

  test('saklar RELEASE_FLOW bukan "tag" (mode langsung) atau tak terbaca: rilis server ditolak sebelum membuat cabang', async () => {
    for (const answer of [
      { code: 0, out: 'langsung\n' },
      { code: 0, out: '\n' },
      { code: 0, out: 'TAG\n' },
      { code: 1, out: 'variabel tidak ada' },
    ]) {
      const shell = fakeShell({ 'gh variable get RELEASE_FLOW': answer });
      await expect(run(shell)).rejects.toThrow(/RELEASE_FLOW/);
      expect(mutating(shell)).toEqual([]);
    }
  });

  test('origin/main bukan leluhur origin/dev', async () => {
    const shell = fakeShell({
      'git merge-base --is-ancestor origin/main origin/dev': { code: 1, out: '' },
    });
    await expect(run(shell)).rejects.toThrow(/main/);
    expect(mutating(shell)).toEqual([]);
  });

  test('staging bukan leluhur dev (dev tak memuat apa yang berjalan di staging)', async () => {
    const shell = fakeShell({
      [`git merge-base --is-ancestor ${STAGING} ${DEV}`]: { code: 1, out: '' },
    });
    await expect(run(shell)).rejects.toThrow(/staging/);
    expect(mutating(shell)).toEqual([]);
  });

  test('selisih staging..dev memuat kode (belum berjalan di staging) ditolak; hanya metadata atau kosong lolos', async () => {
    const code = fakeShell({
      [`git diff --name-only ${STAGING} origin/dev`]: {
        code: 0,
        out: 'server/src/app.ts\nserver/changelog.d/20261117-a.md\n',
      },
    });
    await expect(run(code)).rejects.toThrow(/staging/);
    expect(mutating(code)).toEqual([]);
    const empty = fakeShell({
      [`git diff --name-only ${STAGING} origin/dev`]: { code: 0, out: '' },
    });
    await expect(run(empty)).resolves.toBeDefined();
  });

  test('tanpa fragmen di origin/dev: berhenti sebelum membuat cabang', async () => {
    const shell = fakeShell({
      'git ls-tree --name-only origin/dev -- server/changelog.d/': {
        code: 0,
        out: 'server/changelog.d/.gitkeep\n',
      },
    });
    await expect(run(shell)).rejects.toThrow(/fragmen/i);
    expect(mutating(shell)).toEqual([]);
  });

  test('penunjuk deploy staging belum ada', async () => {
    const shell = fakeShell({
      'git rev-parse refs/remotes/deployed/staging': { code: 128, out: '' },
    });
    await expect(run(shell)).rejects.toThrow(/staging/);
    expect(mutating(shell)).toEqual([]);
  });

  test('cabang rilis sudah ada di origin atau lokal', async () => {
    const remote = fakeShell({
      'git ls-remote --heads origin release/server-v1.0.0': {
        code: 0,
        out: 'abc\trefs/heads/release/server-v1.0.0\n',
      },
    });
    await expect(run(remote)).rejects.toThrow(/release\/server-v1\.0\.0/);
    expect(mutating(remote)).toEqual([]);
    const local = fakeShell({
      'git rev-parse --verify --quiet refs/heads/release/server-v1.0.0': { code: 0, out: 'abc\n' },
    });
    await expect(run(local)).rejects.toThrow(/release\/server-v1\.0\.0/);
    expect(mutating(local)).toEqual([]);
  });

  test('versi eksplisit tidak lebih besar dari tag terakhir', async () => {
    const shell = fakeShell({
      'git tag --list server-v*': { code: 0, out: 'server-v1.2.0\nserver-v1.10.0\n' },
    });
    await expect(run(shell, fakeFiles(baseFiles()), '1.5.0')).rejects.toThrow();
    expect(mutating(shell)).toEqual([]);
  });
});

describe('prepareRelease: jalur sukses', () => {
  test('urutan perintah, berkas diubah, commit hanya berisi metadata, PR ke main berbadan changelog', async () => {
    const shell = fakeShell();
    const files = fakeFiles(baseFiles());
    const result = await prepareRelease({
      component: 'server',
      bump: '1.0.0',
      shell,
      files,
      now: NOW,
    });
    expect(result).toEqual({
      branch: 'release/server-v1.0.0',
      version: '1.0.0',
      prUrl: 'https://github.com/o/r/pull/9',
    });
    expect(mutating(shell)).toEqual([
      'git switch --no-track -c release/server-v1.0.0 origin/dev',
      'bun install --lockfile-only',
      'git add server/package.json bun.lock server/CHANGELOG.md server/changelog.d',
      expect.stringMatching(/^git commit -m chore\(rilis\): server v1\.0\.0/),
      'git push --set-upstream origin release/server-v1.0.0',
      'git switch feat/kerja',
      expect.stringMatching(/^gh pr create --base main --head release\/server-v1\.0\.0 --title /),
    ]);
    expect(files.files['server/package.json']).toContain('"version": "1.0.0"');
    expect(files.files['server/package.json']).toContain('"name": "@qc/server"');
    expect(files.files['server/CHANGELOG.md']).toContain('## [1.0.0] - 2026-11-18');
    expect(files.files['server/changelog.d/20261117-a.md']).toBeUndefined();
    const pr = shell.calls.find((c) => c.startsWith('gh pr create')) ?? '';
    expect(pr).toContain('Fitur A.');
  });

  test('berkas selain metadata di indeks (staged) membatalkan rilis sebelum commit dan memulihkan cabang asal', async () => {
    const shell = fakeShell({
      'git diff --cached --name-only': { code: 0, out: 'server/package.json\nserver/src/app.ts\n' },
    });
    await expect(
      prepareRelease({
        component: 'server',
        bump: '1.0.0',
        shell,
        files: fakeFiles(baseFiles()),
        now: NOW,
      }),
    ).rejects.toThrow(/metadata/);
    expect(mutating(shell).some((c) => c.startsWith('git commit'))).toBe(false);
    expect(mutating(shell).some((c) => c.startsWith('git push'))).toBe(false);
    expect(shell.calls).toContain('git switch feat/kerja');
    expect(shell.calls).toContain('git branch -D release/server-v1.0.0');
  });

  test('tanpa fragmen: gagal setelah cabang dibuat, cabang dibatalkan dan tidak ada push', async () => {
    const shell = fakeShell();
    const initial = baseFiles();
    delete (initial as Record<string, string>)['server/changelog.d/20261117-a.md'];
    await expect(
      prepareRelease({
        component: 'server',
        bump: '1.0.0',
        shell,
        files: fakeFiles(initial),
        now: NOW,
      }),
    ).rejects.toThrow(/fragmen/i);
    expect(shell.calls).toContain('git switch feat/kerja');
    expect(shell.calls).toContain('git branch -D release/server-v1.0.0');
    expect(mutating(shell).some((c) => c.startsWith('git push'))).toBe(false);
  });

  test('push gagal: cabang lokal dibatalkan dan kembali ke cabang asal', async () => {
    const shell = fakeShell({
      'git push --set-upstream origin release/server-v1.0.0': { code: 1, out: 'ditolak' },
    });
    await expect(
      prepareRelease({
        component: 'server',
        bump: '1.0.0',
        shell,
        files: fakeFiles(baseFiles()),
        now: NOW,
      }),
    ).rejects.toThrow(/push/i);
    expect(shell.calls).toContain('git switch feat/kerja');
    expect(shell.calls).toContain('git branch -D release/server-v1.0.0');
    expect(mutating(shell).some((c) => c.startsWith('gh pr create'))).toBe(false);
  });
});

describe('prepareRelease: kegagalan sesudah commit dan PR', () => {
  const go = (shell: Shell) =>
    prepareRelease({
      component: 'server',
      bump: '1.0.0',
      shell,
      files: fakeFiles(baseFiles()),
      now: NOW,
    });

  test('pohon kerja kotor sesudah commit: dibatalkan, tanpa push, kembali ke cabang asal', async () => {
    const shell = fakeShell({
      'git status --porcelain': [
        { code: 0, out: '' },
        { code: 0, out: ' M server/src/x.ts\n' },
      ],
    });
    await expect(go(shell)).rejects.toThrow(/kotor|bersih/i);
    expect(mutating(shell).some((c) => c.startsWith('git push'))).toBe(false);
    expect(shell.calls).toContain('git switch feat/kerja');
    expect(shell.calls).toContain('git branch -D release/server-v1.0.0');
  });

  test('PR gagal dibuka: cabang dipertahankan, kembali ke cabang asal, galat memberi petunjuk manual', async () => {
    const shell = fakeShell({ 'gh pr create': { code: 1, out: 'gh rusak' } });
    await expect(go(shell)).rejects.toThrow(/manual/i);
    expect(shell.calls).toContain('git switch feat/kerja');
    expect(shell.calls).not.toContain('git branch -D release/server-v1.0.0');
  });
});

describe('parseArgs', () => {
  test('komponen, kenaikan, dan --dry-run', () => {
    expect(parseArgs(['server', 'minor'])).toEqual({
      component: 'server',
      bump: 'minor',
      dryRun: false,
    });
    expect(parseArgs(['desktop', '1.0.0', '--dry-run'])).toEqual({
      component: 'desktop',
      bump: '1.0.0',
      dryRun: true,
    });
  });

  test('flag lain, argumen kurang atau lebih, atau komponen tak dikenal ditolak', () => {
    expect(() => parseArgs(['server', 'minor', '--dryrun'])).toThrow(/--dryrun/);
    expect(() => parseArgs(['server', 'minor', '--force'])).toThrow();
    expect(() => parseArgs(['server'])).toThrow();
    expect(() => parseArgs(['server', 'minor', 'extra'])).toThrow();
    expect(() => parseArgs(['web', 'minor'])).toThrow();
  });
});

describe('prepareRelease: --dry-run', () => {
  test('hanya perintah baca; perintah pengubah dicetak, tidak dijalankan; tidak ada PR', async () => {
    const shell = fakeShell();
    const printed: string[] = [];
    const files = fakeFiles(baseFiles());
    const result = await prepareRelease({
      component: 'server',
      bump: '1.0.0',
      shell,
      files,
      now: NOW,
      dryRun: true,
      log: (line) => printed.push(line),
    });
    expect(result).toEqual({ branch: 'release/server-v1.0.0', version: '1.0.0', prUrl: null });
    expect(mutating(shell)).toEqual([]);
    expect(files.files['server/package.json']).toContain('"version": "0.0.0"');
    expect(printed.join('\n')).toContain(
      'git switch --no-track -c release/server-v1.0.0 origin/dev',
    );
    expect(printed.join('\n')).toContain('gh pr create');
  });
});
