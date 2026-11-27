import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { redactSecrets } from '@server/core/redact';
import { fileDigest } from './dump';
import { createDumpScanner } from './dump-scan';
import { parseBackupName } from './names';
import {
  createRestoreDb,
  gunzipTo,
  purgeStaleRestoreDirs,
  type RestoreDb,
  RestoreError,
} from './restore';
import { backupFolderIdOf, listAllEntries } from './upload';
import { compareStructure, readStructure } from './verify-structure';

/**
 * Awalan skema sementara verifikasi. HARUS berawalan `qc_restore_` agar masuk hak pengguna pemulihan terbatas
 * (`GRANT ALL ON qc\_restore\_%`, docs/setup-google.md S8): awalan lain butuh GRANT baru di VPS.
 */
export const VERIFY_SCHEMA_PREFIX = 'qc_restore_verify_';
/** Skema sementara yang lebih tua dari ini dianggap yatim (proses terbunuh) dan dibuang pada verifikasi berikutnya. */
export const VERIFY_ORPHAN_AGE_MS = 40 * 60 * 1000;
/** Batas waktu impor (`mariadb` dihentikan bila lewat). */
export const VERIFY_IMPORT_TIMEOUT_MS = 30 * 60 * 1000;
/** Folder kerja verifikasi (di bawah folder cadangan lokal) dan awalan folder per proses. */
export const VERIFY_WORK_DIR = 'verify-tmp';
const WORK_DIR_PREFIX = 'run-';
/** Perkiraan pengembangan gzip -> SQL (dump nyata sekitar 8x) dengan margin, ditambah ruang tetap. */
const DISK_FACTOR = 12;
const DISK_EXTRA_BYTES = 256 * 1024 * 1024;
/** Daftar rincian di hasil dibatasi agar muat di tabel `settings` dan badan surel. */
const LIST_LIMIT = 10;

export interface VerifyPorts {
  /** Koneksi pemulihan: hak CREATE/DROP pada skema berawalan `schemaPrefix` dan membaca skema tersebut. */
  db: Db;
  /** Mengimpor berkas .sql ke skema (nyata: klien `mariadb`; tes: tiruan). */
  importSql(sqlPath: string, schema: string): Promise<void>;
  /** Awalan skema sementara (bawaan `VERIFY_SCHEMA_PREFIX`; tes memakai awalan `qc_test_`). */
  schemaPrefix?: string;
  close(): Promise<void>;
}

/** `ok` = pemulihan sama dengan dump; `failed` = cadangan/pemulihan bermasalah (final, memicu peringatan); `error` = pemeriksaan tak dapat diselesaikan (dicoba lagi). */
export type VerifyStatus = 'ok' | 'failed' | 'error';

export interface VerifyResult {
  status: VerifyStatus;
  /** Nama berkas cadangan yang diperiksa ('' bila belum terpilih). */
  name: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Satu kalimat untuk log dan badan surel. */
  summary: string;
  failures: string[];
  /** Hal yang patut diketahui tetapi bukan kegagalan (mis. skema hidup berubah sejak dump). */
  notes: string[];
  tables: number;
  rows: number;
  bytes: number;
}

/** Galat yang sudah punya status akhir (tanpa rahasia; pesannya langsung masuk laporan). */
class VerifyError extends Error {
  constructor(
    readonly status: Exclude<VerifyStatus, 'ok'>,
    message: string,
  ) {
    super(message);
    this.name = 'VerifyError';
  }
}

const capped = (items: string[]): string[] =>
  items.length <= LIST_LIMIT
    ? items
    : [...items.slice(0, LIST_LIMIT), `... dan ${items.length - LIST_LIMIT} lainnya`];

function escapeLike(value: string): string {
  return value.replace(/[\\_%]/g, (char) => `\\${char}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nama skema sementara: `<awalan><epoch detik>_<6 heksa>` (stempel waktu memungkinkan penyapuan skema yatim). */
export function verifySchemaName(prefix: string, nowMs: number): string {
  return `${prefix}${Math.floor(nowMs / 1000)}_${randomBytes(3).toString('hex')}`;
}

/** Membuang skema sementara milik proses yang terbunuh (lebih tua dari `VERIFY_ORPHAN_AGE_MS`); mengembalikan namanya. */
export async function sweepOrphanVerifySchemas(
  db: Db,
  prefix: string,
  nowMs: number,
): Promise<string[]> {
  const rows = await db
    .prepare('SELECT SCHEMA_NAME AS s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?')
    .bind(`${escapeLike(prefix)}%`)
    .all<{ s: string }>();
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{9,})_[0-9a-f]{6}$`);
  const restore = createRestoreDb(db);
  const dropped: string[] = [];
  for (const { s } of rows.results) {
    const match = pattern.exec(s);
    if (match === null) continue;
    if (nowMs - Number(match[1]) * 1000 < VERIFY_ORPHAN_AGE_MS) continue;
    await restore.dropSchema(s);
    dropped.push(s);
  }
  return dropped;
}

/** Cadangan lokal terbaru menurut nama (bukan waktu berkas); `null` bila tak ada. */
export async function newestLocalBackup(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const parsed = names.flatMap((name) => {
    const info = parseBackupName(name);
    return info === null ? [] : [{ name, key: info.key }];
  });
  parsed.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return parsed[0]?.name ?? null;
}

interface Integrity {
  size: number;
  driveChecked: boolean;
}

/** Keutuhan berkas lokal dan kecocokannya dengan salinan di Drive (MD5, ukuran, SHA-256 di `appProperties`). */
async function checkIntegrity(env: Env, path: string, name: string): Promise<Integrity> {
  const digest = await fileDigest(path);
  if (digest.size === 0) throw new VerifyError('failed', 'Berkas cadangan lokal kosong');
  const folderId = await backupFolderIdOf(env);
  if (folderId === '') return { size: digest.size, driveChecked: false };
  // Galat Drive (UNAVAILABLE) sengaja dilempar apa adanya: itu `error` (dicoba lagi), bukan bukti cadangan rusak.
  const entry = (await listAllEntries(env, folderId)).find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new VerifyError('failed', 'Cadangan terbaru tidak ada di folder cadangan Drive');
  }
  if (entry.md5Checksum !== digest.md5 || entry.size !== digest.size) {
    throw new VerifyError(
      'failed',
      'MD5/ukuran berkas lokal tidak sama dengan salinan di Drive (salah satunya rusak)',
    );
  }
  const expectedSha = entry.appProperties.sha256;
  if (expectedSha !== undefined && expectedSha !== digest.sha256) {
    throw new VerifyError(
      'failed',
      'SHA-256 berkas lokal tidak sama dengan yang tercatat saat unggah',
    );
  }
  return { size: digest.size, driveChecked: true };
}

async function assertDiskSpace(dir: string, gzipBytes: number): Promise<void> {
  const need = gzipBytes * DISK_FACTOR + DISK_EXTRA_BYTES;
  let free: number;
  try {
    const info = await statfs(dir);
    free = Number(info.bavail) * Number(info.bsize);
  } catch {
    return; // sistem berkas tak melaporkan ruang: lewati (impor yang kehabisan ruang tetap gagal dengan jelas)
  }
  if (free < need) {
    throw new VerifyError(
      'error',
      `Ruang disk folder cadangan tidak cukup untuk membuka dump (butuh sekitar ${Math.ceil(need / 1048576)} MB, tersedia ${Math.floor(free / 1048576)} MB)`,
    );
  }
}

export interface VerifyOptions {
  /** Folder cadangan lokal (`Env.BACKUP_LOCAL_DIR`). */
  localDir: string;
  /** Nama berkas yang diperiksa; kosong = cadangan lokal terbaru. */
  name?: string;
}

/**
 * Verifikasi cadangan: uji pemulihan PENUH berkas lokal ke skema sementara. Tahapan: (1) keutuhan berkas dan kecocokan
 * dengan Drive; (2) gunzip penuh + pemeriksaan isi dump sambil menghitung baris per tabel dari dump itu sendiri; (3)
 * impor ke skema sementara; (4) tabel dan jumlah baris hasil impor HARUS sama persis dengan isi dump; (5) struktur
 * (kolom, indeks, migrasi) dibandingkan dengan skema hidup. Jumlah baris skema hidup TIDAK menjadi kriteria (dump adalah
 * snapshot, basis data berubah sesudahnya; hanya dilaporkan sebagai catatan). Skema sementara dan folder kerja SELALU
 * dibersihkan, juga saat gagal. Tidak melempar: apa pun hasilnya dikembalikan sebagai `VerifyResult`.
 */
export async function runBackupVerification(
  env: Env,
  ports: VerifyPorts,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const startedAt = nowOf(env);
  const clockStart = Date.now();
  const prefix = ports.schemaPrefix ?? VERIFY_SCHEMA_PREFIX;
  const schema = verifySchemaName(prefix, startedAt);
  const restoreDb: RestoreDb = createRestoreDb(ports.db);
  const failures: string[] = [];
  const notes: string[] = [];
  let name = options.name ?? '';
  let bytes = 0;
  let tableCount = 0;
  let rowCount = 0;
  let schemaCreated = false;
  let workDir = '';
  let status: VerifyStatus = 'ok';
  let summary = '';

  try {
    if (name === '') {
      const newest = await newestLocalBackup(options.localDir);
      if (newest === null)
        throw new VerifyError('error', 'Tidak ada berkas cadangan di folder lokal');
      name = newest;
    }
    if (parseBackupName(name) === null)
      throw new VerifyError('failed', 'Nama berkas cadangan tidak dikenal');
    const gzPath = join(options.localDir, name);
    const info = await stat(gzPath).catch(() => null);
    if (info === null || !info.isFile()) {
      throw new VerifyError('error', `Berkas cadangan lokal ${name} tidak ditemukan`);
    }

    const integrity = await checkIntegrity(env, gzPath, name);
    bytes = integrity.size;
    if (!integrity.driveChecked)
      notes.push('Folder cadangan Drive belum dikonfigurasi: kecocokan dengan Drive dilewati');
    await assertDiskSpace(options.localDir, bytes);

    const dropped = await sweepOrphanVerifySchemas(ports.db, prefix, startedAt);
    if (dropped.length > 0) notes.push(`Skema sementara yatim dibuang: ${dropped.length}`);
    const workRoot = join(options.localDir, VERIFY_WORK_DIR);
    await mkdir(workRoot, { recursive: true, mode: 0o700 });
    await purgeStaleRestoreDirs(workRoot, { prefix: WORK_DIR_PREFIX });
    workDir = await mkdtemp(join(workRoot, WORK_DIR_PREFIX));
    const sqlPath = join(workDir, `${name}.sql`);

    const scanner = createDumpScanner();
    await gunzipTo(gzPath, sqlPath, schema, scanner);
    const dump = scanner.end();
    if (dump.tables.length === 0) {
      throw new VerifyError('failed', 'Dump tidak memuat satu pun CREATE TABLE');
    }

    if (await restoreDb.schemaExists(schema)) {
      throw new VerifyError('error', 'Nama skema sementara sudah dipakai; coba lagi');
    }
    await restoreDb.createSchema(schema);
    schemaCreated = true;
    try {
      await ports.importSql(sqlPath, schema);
    } catch (error) {
      throw new VerifyError(
        'failed',
        `Impor dump ke skema sementara gagal: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      );
    }

    // Tabel dan jumlah baris hasil impor HARUS sama persis dengan isi dump (satu-satunya pembanding yang tak terganggu
    // perubahan basis data hidup).
    const restoredTables = await restoreDb.tableNames(schema);
    const dumpTables = new Set(dump.tables);
    for (const table of dump.tables) {
      if (!restoredTables.includes(table))
        failures.push(`Tabel ${table} ada di dump tetapi tidak terbentuk`);
    }
    for (const table of restoredTables) {
      if (!dumpTables.has(table)) failures.push(`Tabel ${table} terbentuk tanpa ada di dump`);
    }
    const liveSchema = (
      await env.DB.prepare('SELECT DATABASE() AS d').first<{ d: string | null }>()
    )?.d;
    const liveDb = createRestoreDb(env.DB);
    const rowFailures: string[] = [];
    const liveDiffs: string[] = [];
    for (const table of restoredTables) {
      if (!dumpTables.has(table)) continue;
      tableCount += 1;
      const restored = await restoreDb.countRows(schema, table);
      const expected = dump.rows.get(table) ?? 0;
      rowCount += restored;
      if (restored !== expected) {
        rowFailures.push(`${table}: dump ${expected} baris, hasil pemulihan ${restored} baris`);
      }
      if (typeof liveSchema === 'string' && liveSchema !== '') {
        const live = await liveDb.countRows(liveSchema, table).catch(() => null);
        if (live !== null && live !== restored) {
          liveDiffs.push(`${table}: pemulihan ${restored}, basis data hidup ${live}`);
        }
      }
    }
    failures.push(...capped(rowFailures));
    if (liveDiffs.length > 0) {
      notes.push(
        `Selisih jumlah baris dengan basis data hidup (wajar: data berubah sejak dump): ${capped(liveDiffs).join('; ')}`,
      );
    }

    const structure =
      typeof liveSchema === 'string' && liveSchema !== ''
        ? compareStructure(
            await readStructure(env.DB, liveSchema),
            await readStructure(ports.db, schema),
          )
        : null;
    if (structure === null) {
      notes.push('Skema hidup tidak dikenali: perbandingan struktur dilewati');
    } else if (structure.migrationsDiffer) {
      notes.push(
        `Daftar migrasi berbeda dengan skema hidup (migrasi baru sejak dump?); perbandingan struktur hanya catatan. Hanya di hidup: ${structure.migrationsOnlyLive.join(', ') || '-'}; hanya di pemulihan: ${structure.migrationsOnlyRestored.join(', ') || '-'}`,
      );
    }
    if (structure !== null) {
      const structureProblems = [
        ...structure.tablesChanged.map(
          (table) => `Struktur tabel ${table} berbeda dengan skema hidup`,
        ),
        ...structure.tablesOnlyLive.map(
          (table) => `Tabel ${table} ada di skema hidup tetapi tidak di pemulihan`,
        ),
        ...structure.tablesOnlyRestored.map(
          (table) => `Tabel ${table} ada di pemulihan tetapi tidak di skema hidup`,
        ),
      ];
      if (structure.migrationsDiffer) notes.push(...capped(structureProblems));
      else failures.push(...capped(structureProblems));
    }

    if (failures.length > 0) {
      status = 'failed';
      summary = `Pemulihan ${name} TIDAK sama dengan isi dump: ${failures.length} masalah`;
    } else {
      summary = `Pemulihan ${name} berhasil: ${tableCount} tabel dan ${rowCount} baris sama persis dengan isi dump`;
    }
  } catch (error) {
    if (error instanceof VerifyError) {
      status = error.status;
      summary = error.message;
    } else if (error instanceof RestoreError) {
      status = 'failed';
      summary = error.message;
    } else {
      status = 'error';
      summary = `Verifikasi tidak dapat diselesaikan: ${redactSecrets(error instanceof Error ? error.message : String(error))}`;
    }
    failures.push(summary);
  } finally {
    if (schemaCreated) {
      try {
        await restoreDb.dropSchema(schema);
      } catch (error) {
        const reason = redactSecrets(error instanceof Error ? error.message : String(error));
        console.error(`verifikasi cadangan: skema sementara ${schema} gagal dibuang: ${reason}`);
        notes.push(
          `Skema sementara ${schema} gagal dibuang (akan disapu pada verifikasi berikutnya)`,
        );
      }
    }
    if (workDir !== '') await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const finishedAt = nowOf(env);
  return {
    status,
    name,
    startedAt,
    finishedAt,
    durationMs: Date.now() - clockStart,
    summary,
    failures: capped(failures),
    notes,
    tables: tableCount,
    rows: rowCount,
    bytes,
  };
}
