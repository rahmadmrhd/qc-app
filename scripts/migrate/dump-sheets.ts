/**
 * CLI dump Sheets -> `dump.json` (T33): sumber `import-sheets.ts` dan `verify-import.ts`. Membaca spreadsheet data
 * tunggal lewat klien Google langsung (`sheetsDump`, service account) dan HANYA membaca; dijalankan pemilik di
 * mesinnya dengan berkas kunci lokal:
 *
 *   bun run scripts/migrate/dump-sheets.ts --out <berkas> [--spreadsheet <id>] [--key-file <jalur>] [--force]
 *
 * `--spreadsheet` bawaan env `GOOGLE_SPREADSHEET_ID`, `--key-file` bawaan env `GOOGLE_SA_KEY_FILE` (isi berkas kunci
 * tidak pernah dibaca di sini, dicetak, atau dimasukkan ke dump). Yang dibaca: semua sheet yang dipetakan
 * `schema-map.ts` (tabel yang diimpor DAN yang dibuang, karena gerbang pembuangan butuh isinya) ditambah sheet
 * penghitung (`counters`) bila ada; sheet `export_*` tidak pernah diminta. Header tiap sheet divalidasi
 * terhadap `schema-map`; satu galat membatalkan seluruh dump (tidak ada berkas setengah jadi). Keluaran
 * `{ "tables": { "<sheet>": [[header...], [baris...]] } }` ditulis atomik (berkas sementara lalu rename) dengan izin
 * 0600, tidak menimpa berkas yang ada tanpa `--force`. Konsol hanya memuat ringkasan nama sheet dan jumlah baris.
 * Kode keluar: 0 berhasil, 1 gagal, 2 salah pakai.
 */
import { rename as fsRename, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { SheetsDump } from '@server/core/bridge-client';
import { isAppError } from '@server/core/errors';
import { createGoogleClient, type GoogleClient } from '@server/core/google/client';
import { type GoogleSettings, isDriveId } from '@server/core/google/settings';
import { IGNORED_SHEETS, legacyColumns, TABLES } from './schema-map';

export const DUMP_USAGE =
  'Pemakaian: dump-sheets.ts --out <berkas> [--spreadsheet <id>] [--key-file <jalur>] [--force]\n' +
  '  --spreadsheet bawaan env GOOGLE_SPREADSHEET_ID; --key-file bawaan env GOOGLE_SA_KEY_FILE (berkas kunci service account).\n' +
  '  Berkas keluaran berisi data pengguna: simpan di luar repositori; tidak menimpa berkas yang ada tanpa --force.';

export interface DumpDeps {
  /** Lingkungan untuk bawaan `--spreadsheet` dan `--key-file` (bawaan: `process.env`). */
  env: Record<string, string | undefined>;
  /** Pembuat klien Google (tes menyuntik klien palsu). */
  createClient: (settings: GoogleSettings) => GoogleClient;
  /** Rename atomik berkas sementara ke tujuan (tes menyuntik kegagalan). */
  rename: (from: string, to: string) => Promise<void>;
}

interface DumpArgs {
  out: string;
  spreadsheet: string;
  keyFile: string;
  force: boolean;
}

/** `null` bila argumen tak dikenal atau `--out` tak ada. */
function parseArgs(argv: readonly string[], env: DumpDeps['env']): DumpArgs | null {
  const values = new Map<string, string>();
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--force') force = true;
    else if (arg === '--out' || arg === '--spreadsheet' || arg === '--key-file') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) return null;
      values.set(arg, value);
    } else return null;
  }
  const out = values.get('--out')?.trim() ?? '';
  if (out === '') return null;
  return {
    out,
    force,
    spreadsheet: (values.get('--spreadsheet') ?? env.GOOGLE_SPREADSHEET_ID ?? '').trim(),
    keyFile: (values.get('--key-file') ?? env.GOOGLE_SA_KEY_FILE ?? '').trim(),
  };
}

/** Sheet yang diminta: semua tabel yang dipetakan, lalu sheet penghitung (opsional). */
export const DUMP_SHEETS: readonly string[] = [
  ...TABLES.map((table) => table.name),
  ...IGNORED_SHEETS,
];

export interface DumpCheck {
  /** Satu baris per masalah, selalu diawali nama sheet. */
  errors: string[];
  /** Peringatan (dump tetap ditulis): kolom legasi berisi data; hanya nomor baris, tanpa isi sel. */
  warnings: string[];
  /** Jumlah baris data (tanpa header) per sheet yang ada di dump. */
  counts: Record<string, number>;
}

/**
 * Memeriksa dump terhadap `schema-map`: tiap sheet yang dipetakan harus ada, berisi header, dan header-nya sama
 * persis dengan kolom yang dipetakan (tanpa kolom hilang, ganda, atau tak dikenal; kolom berheader kosong tidak
 * boleh berisi data karena impor mengabaikannya diam-diam). Sheet penghitung tidak punya kolom terpetakan: dibawa apa adanya.
 */
export function checkDump(dump: SheetsDump): DumpCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  for (const def of TABLES) {
    const grid = dump[def.name];
    if (grid === undefined) {
      errors.push(`${def.name}: sheet tidak ada di spreadsheet`);
      continue;
    }
    const header = grid[0];
    if (header === undefined) {
      errors.push(`${def.name}: sheet kosong, tanpa baris header`);
      continue;
    }
    const names = header.map((cell) => cell.trim());
    const expected = def.columns.map((column) => column.name);
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const name of names) {
      if (name === '') continue;
      if (seen.has(name)) duplicated.add(name);
      seen.add(name);
    }
    const missing = expected.filter((name) => !seen.has(name));
    const legacy = legacyColumns(def.name);
    const unknown = [...seen].filter((name) => !expected.includes(name) && !legacy.includes(name));
    if (missing.length > 0) errors.push(`${def.name}: kolom tidak ada: ${missing.join(', ')}`);
    if (unknown.length > 0) errors.push(`${def.name}: kolom tak dikenal: ${unknown.join(', ')}`);
    if (duplicated.size > 0) errors.push(`${def.name}: kolom ganda: ${[...duplicated].join(', ')}`);
    const blankColumns = names.flatMap((name, index) => (name === '' ? [index] : []));
    const orphaned = blankColumns.filter((index) =>
      grid.slice(1).some((row) => (row[index] ?? '').trim() !== ''),
    );
    if (orphaned.length > 0) {
      errors.push(
        `${def.name}: kolom tanpa nama di header berisi data (nomor kolom ${orphaned.map((index) => index + 1).join(', ')})`,
      );
    }
    for (const name of legacy) {
      const at = names.indexOf(name);
      if (at < 0) continue;
      const filled = grid.flatMap((row, index) =>
        index > 0 && (row[at] ?? '').trim() !== '' ? [index + 1] : [],
      );
      if (filled.length === 0) continue;
      const shown = filled.slice(0, 20).join(', ');
      warnings.push(
        `${def.name}: kolom legasi ${name} berisi data di ${filled.length} baris (nomor baris Sheets: ${shown}${filled.length > 20 ? `, dan ${filled.length - 20} lainnya` : ''}); dump tetap ditulis apa adanya, tetapi import-sheets akan berhenti pada baris itu sampai pemilik memutuskan`,
      );
    }
    counts[def.name] = grid.length - 1;
  }
  for (const name of IGNORED_SHEETS) {
    const grid = dump[name];
    if (grid !== undefined) counts[name] = Math.max(0, grid.length - 1);
  }
  return { errors, warnings, counts };
}

/** Keluaran `dump.json`: hanya sheet yang dipetakan (urutan tetap), bukan sheet lain yang kebetulan ada. */
export function buildDumpTables(dump: SheetsDump): Record<string, string[][]> {
  const tables: Record<string, string[][]> = {};
  for (const name of DUMP_SHEETS) {
    const grid = dump[name];
    if (grid !== undefined) tables[name] = grid;
  }
  return tables;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Pesan galat Google yang aman dicetak: pesan galat aplikasi (tak memuat kunci/token); lainnya hanya namanya. */
function safeMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  return `galat tak terduga (${error instanceof Error ? error.name : typeof error})`;
}

export async function runDumpCli(
  argv: readonly string[],
  deps: Partial<DumpDeps> = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const args = parseArgs(argv, env);
  if (args === null) {
    console.error(DUMP_USAGE);
    return 2;
  }
  if (args.spreadsheet === '' || !isDriveId(args.spreadsheet)) {
    console.error(
      `Id spreadsheet ${args.spreadsheet === '' ? 'belum diisi' : 'tidak valid'}: pakai --spreadsheet atau GOOGLE_SPREADSHEET_ID.`,
    );
    return 2;
  }
  if (args.keyFile === '') {
    console.error(
      'Berkas kunci service account belum diisi: pakai --key-file atau GOOGLE_SA_KEY_FILE.',
    );
    return 2;
  }
  const out = resolve(args.out);
  // Gagal cepat, SEBELUM menyentuh Google: dump lama (mis. arsip final) tidak boleh hilang tanpa disengaja.
  if (!args.force && (await exists(out))) {
    console.error(
      `Berkas ${out} sudah ada; tidak ditimpa. Pakai --force bila memang ingin menggantinya.`,
    );
    return 1;
  }

  const settings: GoogleSettings = {
    GOOGLE_SA_KEY_FILE: args.keyFile,
    GOOGLE_ROOT_FOLDER_ID: '',
    GOOGLE_SPREADSHEET_ID: args.spreadsheet,
    ATTACHMENTS_FOLDER_ID: '',
    QR_FOLDER_ID: '',
    QR_DOC_FOLDER_ID: '',
    BACKUP_FOLDER_ID: '',
    ALLOWED_FOLDER_IDS: [],
  };
  const client = (deps.createClient ?? ((s) => createGoogleClient(s)))(settings);
  let dump: SheetsDump;
  try {
    dump = await client.sheetsDump([...DUMP_SHEETS]);
  } catch (error) {
    console.error(`Gagal membaca Sheets: ${safeMessage(error)}`);
    return 1;
  }

  const check = checkDump(dump);
  if (check.errors.length > 0) {
    console.error(
      `Dump DIBATALKAN: ${check.errors.length} masalah pada spreadsheet (tidak ada berkas ditulis).`,
    );
    for (const message of check.errors) console.error(`- ${message}`);
    return 1;
  }

  const dir = dirname(out);
  const tmp = join(dir, `.${basename(out)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // `wx` + 0600: berkas sementara tak pernah terbaca grup/pengguna lain, bahkan sesaat.
    await writeFile(tmp, JSON.stringify({ tables: buildDumpTables(dump) }), {
      flag: 'wx',
      mode: 0o600,
    });
    if (!args.force && (await exists(out))) {
      throw new Error(`Berkas ${out} baru saja dibuat proses lain; tidak ditimpa`);
    }
    await (deps.rename ?? fsRename)(tmp, out);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    console.error(
      `Gagal menulis ${out}: ${error instanceof Error ? error.message : 'galat tak terduga'}`,
    );
    return 1;
  }

  for (const message of check.warnings) console.warn(`PERINGATAN ${message}`);
  let total = 0;
  console.log(`Dump ${Object.keys(check.counts).length} sheet (hanya baca) -> ${out}`);
  for (const name of DUMP_SHEETS) {
    const rows = check.counts[name];
    if (rows === undefined) continue;
    total += rows;
    console.log(`  ${name}: ${rows} baris`);
  }
  console.log(
    `Total ${total} baris. Berkas berisi data pengguna: simpan di luar repositori dan jangan di-commit.`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await runDumpCli(process.argv.slice(2)));
}
