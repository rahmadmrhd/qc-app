// Perkakas changelog berbasis fragmen (rancangan docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.2;
// format berkas di ...-changelog-dan-unduh-desktop-web-design.md bagian 4).
//
// Satu fragmen = satu berkas `<komponen>/changelog.d/<yyyymmdd>-<slug>.md` berisi satu butir atau lebih, SATU per baris,
// bergaya pesan commit: `tipe(area): ringkasan` (area boleh dihilangkan). Tipe menentukan bagian di changelog (feat =
// Ditambah, fix = Diperbaiki, change/refactor/perf = Diubah, chore/ci/docs/test/build/style = Internal; keputusan pemilik
// 2026-11-19). `compile` menggabung fragmen menjadi bagian versi di `<komponen>/CHANGELOG.md` lalu menghapus
// fragmennya; `extract` mengambil satu bagian (isi GitHub Release dan berkas yang dibawa image).
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
/** `yyyymmdd` adalah tanggal kalender nyata (bukan bulan 13 atau 30 Februari). */
function isCalendarDate(yyyymmdd: string): boolean {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Batas panjang ringkasan satu butir (tanpa awalan `tipe(area): `). */
export const FRAGMENT_MAX_CHARS = 200;

/** Tipe gaya commit yang dikenali dan jenis (bagian changelog) yang dipakainya. */
export const TYPE_TO_KIND: Record<string, FragmentKind> = {
  feat: 'ditambah',
  change: 'diubah',
  refactor: 'diubah',
  perf: 'diubah',
  fix: 'diperbaiki',
  chore: 'internal',
  ci: 'internal',
  docs: 'internal',
  test: 'internal',
  build: 'internal',
  style: 'internal',
};

export const COMPONENTS = ['server', 'desktop'] as const;
export type Component = (typeof COMPONENTS)[number];

/** Satu butir changelog: satu baris fragmen. `area` kosong (null) = tanpa area. */
export interface ChangeEntry {
  kind: FragmentKind;
  area: string | null;
  text: string;
}

export interface Fragment {
  name: string;
  entries: ChangeEntry[];
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

/** `tipe(area): teks` atau `tipe: teks`; area huruf kecil/angka dipisah tanda hubung, tepat satu spasi setelah titik dua. */
const ENTRY_LINE = /^([a-z]+)(?:\(([a-z0-9]+(?:-[a-z0-9]+)*)\))?: (.*)$/;
const TYPES_HINT = Object.keys(TYPE_TO_KIND).join('|');

/**
 * Urai satu fragmen: satu butir per baris (baris kosong diabaikan, baris lanjutan tidak ada). Setiap galat memuat NAMA
 * berkas (dan nomor baris) supaya penulis tahu mana yang harus diperbaiki.
 */
export function parseFragment(name: string, text: string): Fragment {
  const fail = (reason: string): never => {
    throw new ChangelogError(`${name}: ${reason}`);
  };
  if (!FRAGMENT_NAME_PATTERN.test(name) || !isCalendarDate(name.slice(0, 8))) {
    fail('nama harus <yyyymmdd>-<slug-huruf-kecil>.md dengan tanggal kalender yang nyata');
  }
  if (text.includes('\r')) fail('memakai akhir baris Windows (CR); simpan dengan LF');
  const entries: ChangeEntry[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    const where = `baris ${index + 1}`;
    const match = ENTRY_LINE.exec(line);
    if (!match) {
      fail(`${where}: harus "tipe(area): ringkasan" atau "tipe: ringkasan" (tipe: ${TYPES_HINT})`);
    }
    const [, type = '', area, summary = ''] = match as RegExpExecArray;
    const kind = TYPE_TO_KIND[type];
    if (kind === undefined) fail(`${where}: tipe "${type}" tidak dikenal (pilih: ${TYPES_HINT})`);
    const body = summary.trim();
    if (body === '') fail(`${where}: ringkasan kosong`);
    if (body.length > FRAGMENT_MAX_CHARS) {
      fail(
        `${where}: ringkasan terlalu panjang (${body.length} karakter; maksimal ${FRAGMENT_MAX_CHARS})`,
      );
    }
    entries.push({ kind: kind as FragmentKind, area: area ?? null, text: body });
  });
  if (entries.length === 0)
    fail('tidak ada butir perubahan (isi minimal satu baris "tipe(area): ringkasan")');
  return { name, entries };
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
  // Urutan asal = nama fragmen lalu urutan baris; pengurutan per area stabil, jadi urutan asal dijaga dalam satu area.
  const entries = [...fragments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((fragment) => fragment.entries);
  const lines = [`## [${version}] - ${date}`];
  for (const kind of FRAGMENT_KINDS) {
    const group = entries
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => {
        if (a.area === b.area) return 0;
        if (a.area === null) return 1; // tanpa area di akhir
        if (b.area === null) return -1;
        return a.area.localeCompare(b.area);
      });
    if (group.length === 0) continue;
    lines.push(`### ${KIND_HEADINGS[kind]}`);
    for (const entry of group) {
      lines.push(entry.area === null ? `- ${entry.text}` : `- ${entry.area}: ${entry.text}`);
    }
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

/**
 * Operasi berkas nyata terhadap `root` (bawaan akar repositori). `listDir`: folder yang tidak ada = kosong; galat lain
 * (izin, jalur berkas) dilempar; subfolder dilaporkan dengan akhiran `/` agar gagal divalidasi, bukan hilang diam-diam.
 */
export function realDeps(root: string = ROOT_DIR): CliDeps {
  const abs = (path: string) => join(root, path);
  return {
    listDir: (dir) => {
      try {
        return readdirSync(abs(dir), { withFileTypes: true }).map((entry) =>
          entry.isDirectory() ? `${entry.name}/` : entry.name,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
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
