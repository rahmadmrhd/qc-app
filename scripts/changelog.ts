// Perkakas changelog berbasis fragmen (rancangan docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.2;
// format berkas di ...-changelog-dan-unduh-desktop-web-design.md bagian 4).
//
// Satu fragmen = satu berkas `<komponen>/changelog.d/<yyyymmdd>-<slug>.md`: baris pertama `jenis: <jenis>`, sisanya SATU
// paragraf teks untuk pengguna. `compile` menggabung fragmen menjadi bagian versi di `<komponen>/CHANGELOG.md` lalu
// menghapus fragmennya; `extract` mengambil satu bagian (isi GitHub Release dan berkas yang dibawa image).
//
//   bun run changelog validate <server|desktop>
//   bun run changelog compile  <server|desktop> <X.Y.Z> <YYYY-MM-DD>
//   bun run changelog extract  <server|desktop> <X.Y.Z>
//
// Fungsi inti murni (tanpa akses berkas); `runCli` menerima operasi berkas lewat `CliDeps` agar dapat diuji.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './paths';

export const FRAGMENT_KINDS = ['ditambah', 'diubah', 'diperbaiki', 'internal'] as const;
export type FragmentKind = (typeof FRAGMENT_KINDS)[number];

/** Nama fragmen: tanggal 8 digit, slug huruf kecil/angka dipisah tanda hubung, ekstensi `.md`. */
export const FRAGMENT_NAME_PATTERN = /^\d{8}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
/** Batas panjang teks satu fragmen (setelah baris digabung). */
export const FRAGMENT_MAX_CHARS = 500;

export const COMPONENTS = ['server', 'desktop'] as const;
export type Component = (typeof COMPONENTS)[number];

export interface Fragment {
  name: string;
  kind: FragmentKind;
  text: string;
}

/** Judul bagian per jenis, dalam urutan penulisan. */
const KIND_HEADINGS: Record<FragmentKind, string> = {
  ditambah: 'Ditambah',
  diubah: 'Diubah',
  diperbaiki: 'Diperbaiki',
  internal: 'Internal',
};

export class ChangelogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangelogError';
  }
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isSemver(version: string): boolean {
  return SEMVER_PATTERN.test(version);
}

/** Perbandingan numerik per bagian (`1.10.0` > `1.9.0`); hanya untuk versi yang lolos `isSemver`. */
export function compareSemver(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const KIND_LINE = /^jenis: (ditambah|diubah|diperbaiki|internal)$/;

/** Urai satu fragmen. Setiap galat memuat NAMA berkas supaya penulis tahu mana yang harus diperbaiki. */
export function parseFragment(name: string, text: string): Fragment {
  const fail = (reason: string): never => {
    throw new ChangelogError(`${name}: ${reason}`);
  };
  if (!FRAGMENT_NAME_PATTERN.test(name)) {
    fail('nama harus <yyyymmdd>-<slug-huruf-kecil>.md');
  }
  if (text.includes('\r')) fail('memakai akhir baris Windows (CR); simpan dengan LF');
  const lines = text.split('\n');
  const match = KIND_LINE.exec((lines[0] ?? '').trimEnd());
  if (!match) {
    fail(
      `baris pertama harus "jenis: ${FRAGMENT_KINDS.join('|')}" (huruf kecil, satu spasi setelah titik dua)`,
    );
  }
  const body = lines.slice(1).join('\n').trim();
  if (body === '') fail('teks perubahan kosong');
  if (/\n[ \t]*\n/.test(body)) fail('teks harus satu paragraf (tanpa baris kosong di tengah)');
  const joined = body
    .split('\n')
    .map((line) => line.trim())
    .join(' ');
  if (joined.length > FRAGMENT_MAX_CHARS) {
    fail(`teks terlalu panjang (${joined.length} karakter; maksimal ${FRAGMENT_MAX_CHARS})`);
  }
  return { name, kind: (match as RegExpExecArray)[1] as FragmentKind, text: joined };
}

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export interface CompileInput {
  /** Judul berkas bila `existing` masih kosong. */
  title: string;
  existing: string;
  version: string;
  date: string;
  fragments: Fragment[];
}

/** Susun isi `CHANGELOG.md` baru: bagian versi baru diletakkan di atas bagian lama, di bawah pengantar. */
export function compileRelease(input: CompileInput): string {
  const { title, existing, version, date, fragments } = input;
  if (!isSemver(version)) throw new ChangelogError(`Versi "${version}" bukan semver X.Y.Z`);
  if (!isRealDate(date)) throw new ChangelogError(`Tanggal "${date}" harus YYYY-MM-DD yang nyata`);
  if (fragments.length === 0)
    throw new ChangelogError('Tidak ada fragmen perubahan untuk dikompilasi');
  if (new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`, 'm').test(existing)) {
    throw new ChangelogError(`Versi ${version} sudah ada di CHANGELOG`);
  }
  const sorted = [...fragments].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [`## [${version}] - ${date}`];
  for (const kind of FRAGMENT_KINDS) {
    const group = sorted.filter((fragment) => fragment.kind === kind);
    if (group.length === 0) continue;
    lines.push(`### ${KIND_HEADINGS[kind]}`);
    for (const fragment of group) lines.push(`- ${fragment.text}`);
  }
  const section = lines.join('\n');
  if (existing.trim() === '') return `# ${title}\n\n${section}\n`;
  const first = existing.search(/^## \[/m);
  if (first === -1) return `${existing.trimEnd()}\n\n${section}\n`;
  return `${existing.slice(0, first)}${section}\n\n${existing.slice(first)}`;
}

/** Ambil satu bagian versi (judul `## [X.Y.Z] - tanggal` sampai sebelum bagian berikutnya); `null` bila tak ada. */
export function extractSection(changelog: string, version: string): string | null {
  const lines = changelog.split('\n');
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if ((lines[i] as string).startsWith('## [')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

/** Operasi berkas yang disuntik ke `runCli` (jalur relatif terhadap akar repositori). */
export interface CliDeps {
  listDir(dir: string): string[];
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  removeFile(path: string): void;
  print(line: string): void;
}

const isComponent = (value: string | undefined): value is Component =>
  (COMPONENTS as readonly string[]).includes(value ?? '');

function readFragments(dir: string, deps: CliDeps): { fragments: Fragment[]; problems: string[] } {
  const fragments: Fragment[] = [];
  const problems: string[] = [];
  for (const name of deps.listDir(dir).sort()) {
    if (name === '.gitkeep') continue;
    try {
      fragments.push(parseFragment(name, deps.readFile(`${dir}/${name}`)));
    } catch (error) {
      if (!(error instanceof ChangelogError)) throw error;
      problems.push(error.message);
    }
  }
  return { fragments, problems };
}

/** Jalankan perintah CLI; kembalikan kode keluar. Galat tak terduga (mis. disk) dilempar, bukan ditelan. */
export function runCli(argv: string[], deps: CliDeps): number {
  const [command, component, version, date] = argv;
  if (!isComponent(component) || !['validate', 'compile', 'extract'].includes(command ?? '')) {
    deps.print(
      'Pemakaian: changelog validate <server|desktop> | compile <server|desktop> <X.Y.Z> <YYYY-MM-DD> | extract <server|desktop> <X.Y.Z>',
    );
    return 1;
  }
  const dir = `${component}/changelog.d`;
  const file = `${component}/CHANGELOG.md`;

  if (command === 'validate') {
    const { problems } = readFragments(dir, deps);
    for (const problem of problems) deps.print(problem);
    return problems.length === 0 ? 0 : 1;
  }

  if (command === 'extract') {
    const section = extractSection(deps.readFile(file), version ?? '');
    if (section === null) {
      deps.print(`Versi ${version ?? ''} tidak ada di ${file}`);
      return 1;
    }
    deps.print(section);
    return 0;
  }

  // compile: semua pemeriksaan SEBELUM menulis; fragmen dihapus hanya setelah penulisan berhasil.
  const { fragments, problems } = readFragments(dir, deps);
  if (problems.length > 0) {
    for (const problem of problems) deps.print(problem);
    return 1;
  }
  let existing = '';
  try {
    existing = deps.readFile(file);
  } catch {
    existing = '';
  }
  let output: string;
  try {
    output = compileRelease({
      title: `Changelog ${component}`,
      existing,
      version: version ?? '',
      date: date ?? '',
      fragments,
    });
  } catch (error) {
    if (!(error instanceof ChangelogError)) throw error;
    deps.print(error.message);
    return 1;
  }
  deps.writeFile(file, output);
  for (const fragment of fragments) deps.removeFile(`${dir}/${fragment.name}`);
  deps.print(`CHANGELOG ${component} ${version}: ${fragments.length} fragmen dikompilasi.`);
  return 0;
}

function realDeps(): CliDeps {
  const abs = (path: string) => join(ROOT_DIR, path);
  return {
    listDir: (dir) => {
      try {
        return readdirSync(abs(dir));
      } catch {
        return [];
      }
    },
    readFile: (path) => readFileSync(abs(path), 'utf8'),
    writeFile: (path, content) => writeFileSync(abs(path), content),
    removeFile: (path) => rmSync(abs(path)),
    print: (line) => console.log(line),
  };
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2), realDeps()));
}
