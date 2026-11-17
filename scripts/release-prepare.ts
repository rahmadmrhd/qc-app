// "Siapkan rilis" (dijalankan pemilik secara lokal; rancangan docs/superpowers/specs/2026-11-17-rilis-semver-design.md
// bagian 5.3): memotong cabang `release/<komponen>-vX.Y.Z` dari `origin/dev`, menaikkan versi, menyusun changelog dari
// fragmen, mendorong cabang, dan membuka PR ke `main` lewat `gh` (kredensial pemilik, jadi CI PR berjalan normal).
//
//   bun run release:prepare server <patch|minor|major|X.Y.Z> [--dry-run]
//
// Semua prasyarat diperiksa SEBELUM cabang dibuat; kegagalan sesudahnya membatalkan cabang lokal dan kembali ke cabang
// asal. `--dry-run` hanya menjalankan pemeriksaan baca-saja dan mencetak perintah pengubah tanpa menjalankannya.
import {
  type CliDeps,
  type Component,
  compareSemver,
  extractSection,
  isSemver,
  realDeps,
  runCli,
} from './changelog';
import { isFragmentPath, isMetadataOnly, isReleaseChange } from './changelog-check';
import { ROOT_DIR } from './paths';

export interface Shell {
  run(cmd: string[]): Promise<{ code: number; out: string }>;
}

/** Tanggal (YYYY-MM-DD) di zona WIB (Asia/Jakarta, UTC+7 tanpa musim). */
export function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function versionOfTag(tag: string | null): string | null {
  const match = /-v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  return match ? (match[1] as string) : null;
}

/**
 * Versi rilis berikutnya. `bump` = `patch|minor|major` (dihitung dari yang tertinggi antara versi berkas dan tag terakhir)
 * atau versi eksplisit `X.Y.Z` (harus LEBIH BESAR dari keduanya, mis. rilis pertama `1.0.0`).
 */
export function nextVersion(current: string, bump: string, latestTag: string | null): string {
  if (!isSemver(current))
    throw new Error(`Versi di package.json ("${current}") bukan semver X.Y.Z`);
  const latest = versionOfTag(latestTag);
  const base = latest !== null && compareSemver(latest, current) > 0 ? latest : current;
  if (bump === 'patch' || bump === 'minor' || bump === 'major') {
    const [major = 0, minor = 0, patch = 0] = base.split('.').map(Number);
    if (bump === 'major') return `${major + 1}.0.0`;
    if (bump === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }
  if (!isSemver(bump)) {
    throw new Error(
      `Kenaikan "${bump}" tidak dikenal: pakai patch, minor, major, atau versi X.Y.Z`,
    );
  }
  if (compareSemver(bump, base) <= 0) {
    throw new Error(`Versi ${bump} harus lebih besar dari ${base} (versi berkas dan tag terakhir)`);
  }
  return bump;
}

export interface ParsedArgs {
  component: Component;
  bump: string;
  dryRun: boolean;
}

/** Argumen CLI: tepat <komponen> <kenaikan> dan opsional --dry-run; flag lain ditolak (salah ketik tak boleh diabaikan). */
export function parseArgs(args: string[]): ParsedArgs {
  const flags = args.filter((arg) => arg.startsWith('--'));
  const unknown = flags.filter((flag) => flag !== '--dry-run');
  if (unknown.length > 0)
    throw new Error(`Opsi tidak dikenal: ${unknown.join(', ')} (hanya --dry-run)`);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const [component, bump] = positional;
  if (
    positional.length !== 2 ||
    (component !== 'server' && component !== 'desktop') ||
    bump === undefined
  ) {
    throw new Error(
      'Pemakaian: bun run release:prepare <server|desktop> <patch|minor|major|X.Y.Z> [--dry-run]',
    );
  }
  return { component, bump, dryRun: flags.length > 0 };
}

export interface PrepareInput {
  component: Component;
  bump: string;
  shell: Shell;
  files: CliDeps;
  now: Date;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface PrepareResult {
  branch: string;
  version: string;
  prUrl: string | null;
}

export async function prepareRelease(input: PrepareInput): Promise<PrepareResult> {
  const { component, bump, shell, files, now } = input;
  const log = input.log ?? ((line: string) => console.log(line));
  const sh = async (cmd: string[], message?: string): Promise<string> => {
    const result = await shell.run(cmd);
    if (result.code !== 0)
      throw new Error(message ?? `Perintah gagal: ${cmd.join(' ')}\n${result.out}`);
    return result.out;
  };
  const test = async (cmd: string[]): Promise<boolean> => (await shell.run(cmd)).code === 0;

  // 1. Prasyarat (baca-saja).
  if ((await sh(['git', 'status', '--porcelain'])).trim() !== '') {
    throw new Error('Pohon kerja kotor: simpan atau batalkan perubahan lebih dulu (harus bersih).');
  }
  const original = (await sh(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (original === 'HEAD') throw new Error('Detached HEAD: pindah ke sebuah cabang lebih dulu.');
  await sh(['git', 'fetch', 'origin', '--tags', '--prune']);
  if (component === 'server') {
    await sh(['git', 'fetch', 'origin', '+refs/deployed/*:refs/remotes/deployed/*']);
  }
  if (!(await test(['git', 'merge-base', '--is-ancestor', 'origin/main', 'origin/dev']))) {
    throw new Error(
      'origin/main bukan leluhur origin/dev: sinkron rilis sebelumnya (main -> dev) belum masuk. Selesaikan dulu agar versi dan fragmen dihitung dari keadaan terbaru.',
    );
  }
  if (component === 'server') {
    const dev = (await sh(['git', 'rev-parse', 'origin/dev'])).trim();
    const stagingRef = await shell.run(['git', 'rev-parse', 'refs/remotes/deployed/staging']);
    if (stagingRef.code !== 0) {
      throw new Error(
        'Penunjuk deploy staging (refs/deployed/staging) belum ada: deploy staging dulu.',
      );
    }
    const staging = stagingRef.out.trim();
    if (!(await test(['git', 'merge-base', '--is-ancestor', staging, dev]))) {
      throw new Error(
        'Staging bukan leluhur origin/dev: dev tidak memuat apa yang berjalan di staging. Periksa riwayat cabang sebelum merilis.',
      );
    }
    const delta = (await sh(['git', 'diff', '--name-only', staging, 'origin/dev']))
      .split('\n')
      .filter((line) => line.trim() !== '');
    if (!isMetadataOnly(delta, component)) {
      throw new Error(
        'Staging belum memuat semua kode di ujung dev (selisihnya bukan hanya berkas metadata rilis): tunggu deploy staging terbaru selesai. Rilis hanya boleh membawa kode yang sudah berjalan di staging.',
      );
    }
  }
  const fragments = (
    await sh(['git', 'ls-tree', '--name-only', 'origin/dev', '--', `${component}/changelog.d/`])
  )
    .split('\n')
    .filter((path) => isFragmentPath(path.trim()));
  if (fragments.length === 0) {
    throw new Error(
      `Tidak ada fragmen changelog di origin/dev (${component}/changelog.d/): tidak ada yang dirilis.`,
    );
  }
  const tags = (await sh(['git', 'tag', '--list', `${component}-v*`]))
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => new RegExp(`^${component}-v\\d+\\.\\d+\\.\\d+$`).test(tag))
    .sort((a, b) => compareSemver(versionOfTag(a) ?? '0.0.0', versionOfTag(b) ?? '0.0.0'));
  const current = (
    JSON.parse(await sh(['git', 'show', `origin/dev:${component}/package.json`])) as {
      version?: string;
    }
  ).version;
  const version = nextVersion(current ?? '', bump, tags.at(-1) ?? null);
  const branch = `release/${component}-v${version}`;
  const remote = await sh(['git', 'ls-remote', '--heads', 'origin', branch]);
  const local = await shell.run([
    'git',
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ]);
  if (remote.trim() !== '' || local.code === 0) {
    throw new Error(
      `Cabang ${branch} sudah ada (di origin atau lokal): hapus atau pakai versi lain.`,
    );
  }

  const title = `Rilis ${component} v${version}`;
  const planned = [
    ['git', 'switch', '--no-track', '-c', branch, 'origin/dev'],
    ['(ubah version di package.json, susun CHANGELOG dari fragmen)'],
    ['bun', 'install', '--lockfile-only'],
    [
      'git',
      'add',
      `${component}/package.json`,
      'bun.lock',
      `${component}/CHANGELOG.md`,
      `${component}/changelog.d`,
    ],
    ['git', 'commit', '-m', `chore(rilis): ${component} v${version}`],
    ['git', 'push', '--set-upstream', 'origin', branch],
    ['git', 'switch', original],
    [
      'gh',
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      title,
      '--body',
      '<bagian CHANGELOG>',
    ],
  ];
  if (input.dryRun) {
    log(
      `[dry-run] ${title} (cabang asal: ${original}). Pemeriksaan lulus; perintah yang akan dijalankan:`,
    );
    for (const cmd of planned) log(`[dry-run] ${cmd.join(' ')}`);
    return { branch, version, prUrl: null };
  }

  // 2. Perubahan. Kegagalan sebelum push membatalkan cabang lokal.
  let created = false;
  try {
    await sh(['git', 'switch', '--no-track', '-c', branch, 'origin/dev']);
    created = true;
    const packagePath = `${component}/package.json`;
    const text = files.readFile(packagePath);
    if (!/"version"\s*:\s*"[^"]*"/.test(text))
      throw new Error(`${packagePath} tidak memuat "version"`);
    files.writeFile(packagePath, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));

    const messages: string[] = [];
    const exit = runCli(['compile', component, version, wibDate(now)], {
      ...files,
      print: (line) => {
        messages.push(line);
        files.print(line);
      },
    });
    if (exit !== 0) throw new Error(`Kompilasi changelog gagal: ${messages.join('; ')}`);

    await sh(['bun', 'install', '--lockfile-only']);
    await sh(['git', 'add', ...(planned[3] as string[]).slice(2)]);
    const staged = (await sh(['git', 'diff', '--cached', '--name-only']))
      .split('\n')
      .filter((l) => l.trim() !== '');
    if (!isReleaseChange(staged, component)) {
      throw new Error(
        `Commit rilis hanya boleh berisi berkas metadata, tetapi memuat: ${staged.join(', ')}`,
      );
    }
    await sh(['git', 'commit', '-m', `chore(rilis): ${component} v${version}`]);
    if ((await sh(['git', 'status', '--porcelain'])).trim() !== '') {
      throw new Error(
        'Pohon kerja tidak bersih setelah commit rilis (ada perubahan di luar metadata): rilis dibatalkan.',
      );
    }
    await sh(['git', 'push', '--set-upstream', 'origin', branch], `git push gagal untuk ${branch}`);
  } catch (error) {
    if (created) {
      await shell.run(['git', 'reset', '--hard']);
      await shell.run(['git', 'switch', original]);
      await shell.run(['git', 'branch', '-D', branch]);
    }
    throw error;
  }

  // 3. Kembali ke cabang asal, lalu PR (cabang sudah di origin; bila PR gagal, cabang dibiarkan agar PR dapat dibuat manual).
  const section = extractSection(files.readFile(`${component}/CHANGELOG.md`), version) ?? title;
  const back = await shell.run(['git', 'switch', original]);
  if (back.code !== 0) {
    log(`Peringatan: gagal kembali ke cabang ${original}: ${back.out.trim()}`);
  }
  const pr = await shell.run([
    'gh',
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    title,
    '--body',
    section,
  ]);
  if (pr.code !== 0) {
    throw new Error(
      `Cabang ${branch} sudah didorong, tetapi membuka PR gagal: ${pr.out}\nBuat PR ke main secara manual.`,
    );
  }
  return { branch, version, prUrl: pr.out.trim() };
}

function realShell(): Shell {
  return {
    async run(cmd) {
      const proc = Bun.spawn(cmd, {
        cwd: ROOT_DIR,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
      });
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      return { code, out: code === 0 ? out : `${out}${err}` };
    },
  };
}

if (import.meta.main) {
  try {
    const { component, bump, dryRun } = parseArgs(process.argv.slice(2));
    const result = await prepareRelease({
      component,
      bump,
      shell: realShell(),
      files: realDeps(),
      now: new Date(),
      dryRun,
    });
    console.log(
      result.prUrl ? `PR rilis dibuka: ${result.prUrl}` : `(dry-run) ${result.branch} siap dibuat.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
