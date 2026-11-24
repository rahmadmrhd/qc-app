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
    // komponen desktop dan rilis gabungan
    'git ls-tree --name-only origin/dev -- desktop/changelog.d/': {
      code: 0,
      out: 'desktop/changelog.d/20261117-b.md\n',
    },
    'git tag --list desktop-v*': { code: 0, out: '' },
    'git show origin/dev:desktop/package.json': {
      code: 0,
      out: '{\n  "name": "@qc/desktop",\n  "version": "0.0.0"\n}\n',
    },
    'git ls-remote --heads origin release/desktop-v1.0.0': { code: 0, out: '' },
    'git rev-parse --verify --quiet refs/heads/release/desktop-v1.0.0': { code: 1, out: '' },
    'git ls-remote --heads origin release/gabungan-server-v1.0.0-desktop-v1.0.0': {
      code: 0,
      out: '',
    },
    'git rev-parse --verify --quiet refs/heads/release/gabungan-server-v1.0.0-desktop-v1.0.0': {
      code: 1,
      out: '',
    },
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

const MUTATING =
  /^(git switch|git branch -D|git add|git commit|git push|gh pr create|bun install|bun run api:snapshot)/;
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
  'server/changelog.d/20261117-a.md': 'feat(web): Fitur A.',
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

  test('selisih memuat bun.lock/package.json: lolos hanya bila isinya berubah di versi saja', async () => {
    const pkg = (version: string, dep = '^4.0.0') =>
      JSON.stringify({ name: '@qc/server', version, dependencies: { hono: dep } });
    const delta = {
      [`git diff --name-only ${STAGING} origin/dev`]: {
        code: 0,
        out: 'server/package.json\nserver/changelog.d/20261117-a.md\n',
      },
    };
    const branchFree = {
      'git ls-remote --heads origin release/server-v1.1.0': { code: 0, out: '' },
      'git rev-parse --verify --quiet refs/heads/release/server-v1.1.0': { code: 1, out: '' },
    };
    const versionOnly = fakeShell({
      ...delta,
      ...branchFree,
      [`git show ${STAGING}:server/package.json`]: { code: 0, out: pkg('0.0.0') },
      'git show origin/dev:server/package.json': { code: 0, out: pkg('1.0.0') },
    });
    await expect(run(versionOnly, fakeFiles(baseFiles()), '1.1.0')).resolves.toBeDefined();
    const dependencyChanged = fakeShell({
      ...delta,
      ...branchFree,
      [`git show ${STAGING}:server/package.json`]: { code: 0, out: pkg('0.0.0') },
      'git show origin/dev:server/package.json': { code: 0, out: pkg('0.0.0', '^9.0.0') },
    });
    await expect(run(dependencyChanged, fakeFiles(baseFiles()), '1.1.0')).rejects.toThrow(
      /staging/,
    );
    expect(mutating(dependencyChanged)).toEqual([]);
  });

  test('selisih staging..dev hanya berkas di luar image server (kode desktop, dokumentasi) lolos: PR itu tak men-deploy staging', async () => {
    const outside = fakeShell({
      [`git diff --name-only ${STAGING} origin/dev`]: {
        code: 0,
        out: 'desktop/src/main/index.ts\ndesktop/changelog.d/20261119-a.md\ndocs/ci-cd.md\n',
      },
    });
    await expect(run(outside)).resolves.toBeDefined();
    const mixed = fakeShell({
      [`git diff --name-only ${STAGING} origin/dev`]: {
        code: 0,
        out: 'docs/ci-cd.md\nweb/src/main.tsx\n',
      },
    });
    await expect(run(mixed)).rejects.toThrow(/staging/);
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
      'bun run api:snapshot',
      'bun install --lockfile-only',
      'git add server/package.json bun.lock server/CHANGELOG.md server/changelog.d shared/api-contract.snapshot.json',
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

const BOTH_BRANCH = 'release/gabungan-server-v1.0.0-desktop-v1.0.0';
const bothFiles = () => ({
  ...baseFiles(),
  'desktop/package.json': '{\n  "name": "@qc/desktop",\n  "version": "0.0.0"\n}\n',
  'desktop/CHANGELOG.md': '# Changelog desktop\n',
  'desktop/changelog.d/20261117-b.md': 'change(desktop): Fitur B.',
});
const BOTH_STAGED =
  'server/package.json\ndesktop/package.json\nbun.lock\nserver/CHANGELOG.md\ndesktop/CHANGELOG.md\nserver/changelog.d/20261117-a.md\ndesktop/changelog.d/20261117-b.md\n';
const both = (shell: Shell, files = fakeFiles(bothFiles()), extra: { dryRun?: boolean } = {}) =>
  prepareRelease({
    component: 'both',
    bump: '1.0.0',
    desktopBump: '1.0.0',
    shell,
    files,
    now: NOW,
    ...extra,
  });

describe('prepareRelease: rilis gabungan server + desktop (satu cabang, satu commit, satu PR)', () => {
  test('jalur sukses: satu cabang gabungan, kedua versi dan changelog diubah, satu PR berbadan kedua bagian', async () => {
    const shell = fakeShell({ 'git diff --cached --name-only': { code: 0, out: BOTH_STAGED } });
    const files = fakeFiles(bothFiles());
    const result = await both(shell, files);
    expect(result).toEqual({
      branch: BOTH_BRANCH,
      version: 'server 1.0.0 + desktop 1.0.0',
      versions: { server: '1.0.0', desktop: '1.0.0' },
      prUrl: 'https://github.com/o/r/pull/9',
    });
    expect(mutating(shell)).toEqual([
      `git switch --no-track -c ${BOTH_BRANCH} origin/dev`,
      'bun run api:snapshot',
      'bun install --lockfile-only',
      'git add server/package.json desktop/package.json bun.lock server/CHANGELOG.md desktop/CHANGELOG.md server/changelog.d desktop/changelog.d shared/api-contract.snapshot.json',
      expect.stringMatching(/^git commit -m chore\(rilis\): server v1\.0\.0 \+ desktop v1\.0\.0/),
      `git push --set-upstream origin ${BOTH_BRANCH}`,
      'git switch feat/kerja',
      expect.stringMatching(
        new RegExp(
          `^gh pr create --base main --head ${BOTH_BRANCH.replaceAll('/', '\\/')} --title `,
        ),
      ),
    ]);
    expect(files.files['server/package.json']).toContain('"version": "1.0.0"');
    expect(files.files['desktop/package.json']).toContain('"version": "1.0.0"');
    expect(files.files['server/CHANGELOG.md']).toContain('## [1.0.0] - 2026-11-18');
    expect(files.files['desktop/CHANGELOG.md']).toContain('## [1.0.0] - 2026-11-18');
    expect(files.files['server/changelog.d/20261117-a.md']).toBeUndefined();
    expect(files.files['desktop/changelog.d/20261117-b.md']).toBeUndefined();
    const pr = shell.calls.find((c) => c.startsWith('gh pr create')) ?? '';
    expect(pr).toContain('--title Rilis server v1.0.0 + desktop v1.0.0');
    expect(pr).toContain('Fitur A.');
    expect(pr).toContain('Fitur B.');
  });

  test('kenaikan dihitung per komponen (versi dan tag masing-masing)', async () => {
    const shell = fakeShell({
      'git diff --cached --name-only': { code: 0, out: BOTH_STAGED },
      'git tag --list desktop-v*': { code: 0, out: 'desktop-v1.4.0\n' },
      'git show origin/dev:desktop/package.json': {
        code: 0,
        out: '{\n  "name": "@qc/desktop",\n  "version": "1.4.0"\n}\n',
      },
      'git ls-remote --heads origin release/gabungan-server-v1.0.0-desktop-v1.4.1': {
        code: 0,
        out: '',
      },
      'git rev-parse --verify --quiet refs/heads/release/gabungan-server-v1.0.0-desktop-v1.4.1': {
        code: 1,
        out: '',
      },
    });
    const result = await prepareRelease({
      component: 'both',
      bump: '1.0.0',
      desktopBump: 'patch',
      shell,
      files: fakeFiles(bothFiles()),
      now: NOW,
    });
    expect(result.branch).toBe('release/gabungan-server-v1.0.0-desktop-v1.4.1');
  });

  test('prasyarat server berlaku (saklar RELEASE_FLOW, staging) dan berhenti SEBELUM membuat cabang', async () => {
    const flow = fakeShell({ 'gh variable get RELEASE_FLOW': { code: 0, out: 'langsung\n' } });
    await expect(both(flow)).rejects.toThrow(/RELEASE_FLOW/);
    expect(mutating(flow)).toEqual([]);
    const staging = fakeShell({
      'git rev-parse refs/remotes/deployed/staging': { code: 128, out: '' },
    });
    await expect(both(staging)).rejects.toThrow(/staging/);
    expect(mutating(staging)).toEqual([]);
  });

  test('tanpa fragmen pada SALAH SATU komponen: ditolak sebelum membuat cabang, menyebut komponennya', async () => {
    const noDesktop = fakeShell({
      'git ls-tree --name-only origin/dev -- desktop/changelog.d/': {
        code: 0,
        out: 'desktop/changelog.d/.gitkeep\n',
      },
    });
    await expect(both(noDesktop)).rejects.toThrow(/desktop\/changelog\.d/);
    expect(mutating(noDesktop)).toEqual([]);
    const noServer = fakeShell({
      'git ls-tree --name-only origin/dev -- server/changelog.d/': {
        code: 0,
        out: 'server/changelog.d/.gitkeep\n',
      },
    });
    await expect(both(noServer)).rejects.toThrow(/server\/changelog\.d/);
    expect(mutating(noServer)).toEqual([]);
  });

  test('versi eksplisit tidak sah pada salah satu komponen ditolak sebelum membuat cabang', async () => {
    const shell = fakeShell();
    await expect(
      prepareRelease({
        component: 'both',
        bump: '1.0.0',
        desktopBump: 'besar',
        shell,
        files: fakeFiles(bothFiles()),
        now: NOW,
      }),
    ).rejects.toThrow();
    expect(mutating(shell)).toEqual([]);
  });

  test('cabang gabungan sudah ada di origin atau lokal ditolak', async () => {
    const remote = fakeShell({
      [`git ls-remote --heads origin ${BOTH_BRANCH}`]: {
        code: 0,
        out: `abc\trefs/heads/${BOTH_BRANCH}\n`,
      },
    });
    await expect(both(remote)).rejects.toThrow(/gabungan/);
    expect(mutating(remote)).toEqual([]);
  });

  test('indeks tanpa CHANGELOG salah satu komponen, atau memuat berkas lain, membatalkan rilis dan memulihkan cabang asal', async () => {
    for (const out of [
      'server/package.json\ndesktop/package.json\nbun.lock\nserver/CHANGELOG.md\nserver/changelog.d/20261117-a.md\n',
      `${BOTH_STAGED}server/src/app.ts\n`,
    ]) {
      const shell = fakeShell({ 'git diff --cached --name-only': { code: 0, out } });
      await expect(both(shell)).rejects.toThrow(/metadata|CHANGELOG/);
      expect(mutating(shell).some((c) => c.startsWith('git commit'))).toBe(false);
      expect(mutating(shell).some((c) => c.startsWith('git push'))).toBe(false);
      expect(shell.calls).toContain('git switch feat/kerja');
      expect(shell.calls).toContain(`git branch -D ${BOTH_BRANCH}`);
    }
  });

  test('--dry-run: hanya perintah baca, perintah pengubah dicetak, tanpa PR', async () => {
    const shell = fakeShell();
    const printed: string[] = [];
    const files = fakeFiles(bothFiles());
    const result = await prepareRelease({
      component: 'both',
      bump: '1.0.0',
      desktopBump: '1.0.0',
      shell,
      files,
      now: NOW,
      dryRun: true,
      log: (line) => printed.push(line),
    });
    expect(result.prUrl).toBeNull();
    expect(result.branch).toBe(BOTH_BRANCH);
    expect(mutating(shell)).toEqual([]);
    expect(files.files['desktop/package.json']).toContain('"version": "0.0.0"');
    expect(printed.join('\n')).toContain(`git switch --no-track -c ${BOTH_BRANCH} origin/dev`);
  });
});

describe('parseArgs: both', () => {
  test('both <kenaikan-server> <kenaikan-desktop> [--dry-run]', () => {
    expect(parseArgs(['both', 'minor', 'patch'])).toEqual({
      component: 'both',
      bump: 'minor',
      desktopBump: 'patch',
      dryRun: false,
    });
    expect(parseArgs(['both', '1.0.0', '2.0.0', '--dry-run'])).toEqual({
      component: 'both',
      bump: '1.0.0',
      desktopBump: '2.0.0',
      dryRun: true,
    });
  });

  test('jumlah argumen salah ditolak: both butuh dua kenaikan, komponen tunggal tepat satu', () => {
    expect(() => parseArgs(['both', 'minor'])).toThrow();
    expect(() => parseArgs(['both', 'minor', 'patch', 'major'])).toThrow();
    expect(() => parseArgs(['server', 'minor', 'patch'])).toThrow();
    expect(() => parseArgs(['both'])).toThrow();
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

describe('prepareRelease: potret kontrak API dan pagar umur 24 jam (rilis yang memuat server)', () => {
  const SNAP = 'shared/api-contract.snapshot.json';
  const OLD_SNAPSHOT = '[{"id":"a.old","verb":"GET","path":"/a","deprecated":true}]';
  // Tag sebelumnya terbit tepat 24 jam sebelum NOW (2026-11-17T17:30Z).
  const TAG_DATE = '2026-11-16T17:30:00+00:00';
  const DAY_MS = '86400000';
  const PREV_FILE = '/tmp/api-snapshot-server-v0.9.0.json';
  const withTag = (extra: Record<string, Result> = {}): Record<string, Result> => ({
    'git tag --list server-v*': { code: 0, out: 'server-v0.9.0\n' },
    [`git show server-v0.9.0:${SNAP}`]: { code: 0, out: OLD_SNAPSHOT },
    'git log -1 --format=%cI server-v0.9.0': { code: 0, out: `${TAG_DATE}\n` },
    ...extra,
  });

  /** Tempat sementara palsu: merekam isi yang ditulis dan jalur yang dibuang (tak menyentuh disk). */
  function fakeScratch() {
    const written: Record<string, string> = {};
    const removed: string[] = [];
    return {
      written,
      removed,
      scratch: {
        write: (name: string, content: string) => {
          written[name] = content;
          return `/tmp/${name}`;
        },
        remove: (path: string) => {
          removed.push(path);
        },
      },
    };
  }

  const server = (
    shell: Shell,
    extra: Partial<Parameters<typeof prepareRelease>[0]> = {},
    files = fakeFiles(baseFiles()),
  ) => prepareRelease({ component: 'server', bump: '1.0.0', shell, files, now: NOW, ...extra });

  test('rilis server dengan tag sebelumnya: potret tag dan umurnya dibaca sebelum cabang dibuat; pagar jalan SEBELUM versi diubah; potret dibuat ulang dan ikut commit', async () => {
    const files = fakeFiles(baseFiles());
    const base = fakeShell(withTag());
    let versionAtCheck = '';
    const shell: Shell & { calls: string[] } = {
      calls: base.calls,
      async run(cmd) {
        if (cmd.join(' ').startsWith('bun run scripts/api-removal-check.ts')) {
          versionAtCheck = files.files['server/package.json'] ?? '';
        }
        return base.run(cmd);
      },
    };
    const { scratch, written, removed } = fakeScratch();
    await server(shell, { scratch }, files);
    const at = (needle: string) => shell.calls.findIndex((c) => c.startsWith(needle));
    const switchAt = at('git switch --no-track -c');
    expect(at(`git show server-v0.9.0:${SNAP}`)).toBeGreaterThan(-1);
    expect(at(`git show server-v0.9.0:${SNAP}`)).toBeLessThan(switchAt);
    expect(at('git log -1 --format=%cI server-v0.9.0')).toBeGreaterThan(-1);
    expect(at('git log -1 --format=%cI server-v0.9.0')).toBeLessThan(switchAt);
    const checkAt = at('bun run scripts/api-removal-check.ts');
    expect(shell.calls[checkAt]).toBe(
      `bun run scripts/api-removal-check.ts ${PREV_FILE} ${DAY_MS}`,
    );
    expect(checkAt).toBeGreaterThan(switchAt);
    expect(checkAt).toBeLessThan(at('bun run api:snapshot'));
    expect(checkAt).toBeLessThan(at('bun install --lockfile-only'));
    // Pagar berjalan sebelum package.json disentuh.
    expect(versionAtCheck).toContain('"version": "0.0.0"');
    expect(written['api-snapshot-server-v0.9.0.json']).toBe(OLD_SNAPSHOT);
    expect(removed).toEqual([PREV_FILE]);
    const add = shell.calls.find((c) => c.startsWith('git add')) ?? '';
    expect(add.split(' ')).toContain(SNAP);
  });

  test('pagar menolak (kode 1): rilis dibatalkan, cabang lokal dibuang, tanpa push, galat memuat keluarannya', async () => {
    const shell = fakeShell(
      withTag({
        [`bun run scripts/api-removal-check.ts ${PREV_FILE} ${DAY_MS}`]: {
          code: 1,
          out: 'Rute a.old baru berstatus deprecated kurang dari 24 jam\n',
        },
      }),
    );
    const { scratch, removed } = fakeScratch();
    await expect(server(shell, { scratch })).rejects.toThrow(/a\.old.*24 jam/s);
    expect(shell.calls).toContain('git branch -D release/server-v1.0.0');
    expect(shell.calls.some((c) => c.startsWith('git push'))).toBe(false);
    expect(shell.calls.some((c) => c.startsWith('bun run api:snapshot'))).toBe(false);
    // Berkas sementara dibuang walau pagar menolak.
    expect(removed).toEqual([PREV_FILE]);
  });

  test('tanpa tag server sebelumnya: potret tag tak dibaca, pagar dijalankan dengan umur none dan potret kosong', async () => {
    const shell = fakeShell();
    const { scratch, written } = fakeScratch();
    await server(shell, { scratch });
    expect(shell.calls.some((c) => c.startsWith('git show server-v'))).toBe(false);
    expect(shell.calls.some((c) => c.startsWith('git log -1 --format=%cI'))).toBe(false);
    expect(shell.calls).toContain(
      'bun run scripts/api-removal-check.ts /tmp/api-snapshot-none.json none',
    );
    expect(written['api-snapshot-none.json']).toBe('[]');
  });

  test('potret pada tag tak terbaca: berhenti sebelum membuat cabang apa pun', async () => {
    const shell = fakeShell(
      withTag({ [`git show server-v0.9.0:${SNAP}`]: { code: 128, out: 'tak ada' } }),
    );
    await expect(server(shell, { scratch: fakeScratch().scratch })).rejects.toThrow(/potret/i);
    expect(mutating(shell)).toEqual([]);
  });

  test('umur tag tak terbaca (tanggal rusak, perintah gagal, atau di masa depan): berhenti sebelum membuat cabang apa pun', async () => {
    for (const answer of [
      { code: 0, out: 'bukan-tanggal\n' },
      { code: 128, out: 'galat' },
      { code: 0, out: '2026-11-18T00:00:00+00:00\n' },
    ]) {
      const shell = fakeShell(withTag({ 'git log -1 --format=%cI server-v0.9.0': answer }));
      await expect(server(shell, { scratch: fakeScratch().scratch })).rejects.toThrow(
        /umur|tanggal/i,
      );
      expect(mutating(shell)).toEqual([]);
    }
  });

  test('rilis desktop saja tidak menyentuh potret kontrak sama sekali', async () => {
    const shell = fakeShell({
      'git diff --cached --name-only': {
        code: 0,
        out: 'desktop/package.json\nbun.lock\ndesktop/CHANGELOG.md\ndesktop/changelog.d/20261117-b.md\n',
      },
    });
    await prepareRelease({
      component: 'desktop',
      bump: '1.0.0',
      shell,
      files: fakeFiles(bothFiles()),
      now: NOW,
    });
    expect(shell.calls.some((c) => /api-removal-check|api:snapshot|api-contract/.test(c))).toBe(
      false,
    );
  });

  test('--dry-run: pembacaan tetap jalan, perintah pengubah tak dijalankan, langkah potret dan pagar dicetak', async () => {
    const shell = fakeShell(withTag());
    const printed: string[] = [];
    const { scratch, written } = fakeScratch();
    await server(shell, { scratch, dryRun: true, log: (line) => printed.push(line) });
    expect(shell.calls).toContain(`git show server-v0.9.0:${SNAP}`);
    expect(mutating(shell)).toEqual([]);
    expect(shell.calls.some((c) => c.startsWith('bun run scripts/api-removal-check.ts'))).toBe(
      false,
    );
    expect(Object.keys(written)).toEqual([]);
    const text = printed.join('\n');
    expect(text).toContain('api-removal-check');
    expect(text).toContain('bun run api:snapshot');
    expect(text).toContain(SNAP);
  });
});
