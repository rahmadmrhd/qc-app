import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { BridgeClient, DriveFolderEntry } from '@server/core/bridge-client';
import type { Db } from '@server/core/db';
import { redactSecrets } from '@server/core/redact';
import { clientArgs, type DumpTarget } from './dump';
import { listAllEntriesVia, recognizedBackups } from './upload';

const SCHEMA_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const TAIL_BYTES = 1024;

/** Galat pemulihan yang aman ditampilkan (tanpa rahasia). */
export class RestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreError';
  }
}

/** Operasi basis data yang dibutuhkan pemulihan (nyata: `createRestoreDb`; tes: tiruan). */
export interface RestoreDb {
  schemaExists(schema: string): Promise<boolean>;
  tableNames(schema: string): Promise<string[]>;
  createSchema(schema: string): Promise<void>;
  dropSchema(schema: string): Promise<void>;
  countRows(schema: string, table: string): Promise<number>;
}

export interface RestoreDeps {
  bridge: BridgeClient;
  folderId: string;
  /** Folder kerja sementara (dibuat dan dibersihkan sendiri). */
  workDir: string;
  db: RestoreDb;
  /** Mengimpor berkas .sql ke skema (nyata: klien `mariadb`; tes: tiruan). */
  importSql(sqlPath: string, schema: string): Promise<void>;
  /** Skema yang tidak boleh menjadi target (skema aplikasi yang sedang dipakai). */
  protectedSchemas?: string[];
}

export interface RestoreOptions {
  /** Id berkas Drive; kosong = cadangan terbaru. */
  fileId?: string;
  targetSchema: string;
  /** Bandingkan jumlah baris per tabel dengan skema ini (mis. skema sumber dump). */
  compareWith?: string;
  /** Hapus skema target setelah selesai (uji pemulihan). */
  dropAfter?: boolean;
}

export interface TableCount {
  table: string;
  restored: number;
  /** Ada bila `compareWith` diberikan; `null` = tabel tidak ada di skema pembanding. */
  source?: number | null;
}

export interface RestoreReport {
  name: string;
  driveId: string;
  size: number;
  md5: string;
  sha256: string;
  schema: string;
  tables: TableCount[];
  /** Ada bila `compareWith` diberikan: semua jumlah baris sama dan tidak ada tabel yang kurang. */
  matched?: boolean;
  dropped: boolean;
}

interface Digests {
  md5: string;
  sha256: string;
  size: number;
}

/** Unduh streaming ke `path` sambil menghitung MD5/SHA-256/ukuran. */
async function downloadTo(body: ReadableStream<Uint8Array>, path: string): Promise<Digests> {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  let size = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      md5.update(chunk);
      sha256.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body as import('node:stream/web').ReadableStream),
    hasher,
    createWriteStream(path),
  );
  return { md5: md5.digest('hex'), sha256: sha256.digest('hex'), size };
}

/**
 * Gunzip PENUH ke `sqlPath` (gzip yang terpotong atau rusak baru ketahuan di ujung aliran, karena itu seluruhnya
 * dibuka SEBELUM apa pun diimpor). Memeriksa baris penutup "Dump completed" dan menolak SQL yang memuat
 * `CREATE DATABASE`/`USE` (akan menimpa skema lain, bukan skema target).
 */
async function gunzipTo(gzPath: string, sqlPath: string): Promise<void> {
  let tail = '';
  let foreignDatabase = false;
  const inspector = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const window = tail + chunk.toString('latin1');
      if (/^(CREATE DATABASE|USE `)/im.test(window)) foreignDatabase = true;
      tail = window.slice(-TAIL_BYTES);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(createReadStream(gzPath), createGunzip(), inspector, createWriteStream(sqlPath));
  } catch {
    throw new RestoreError(
      'Berkas cadangan rusak atau terpotong (gunzip gagal); tidak ada yang diimpor',
    );
  }
  if (!/-- Dump completed/.test(tail)) {
    throw new RestoreError(
      'Dump di dalam cadangan tidak lengkap (baris penutup tidak ada); tidak ada yang diimpor',
    );
  }
  if (foreignDatabase) {
    throw new RestoreError('Dump memuat CREATE DATABASE/USE dan dapat menimpa skema lain; ditolak');
  }
}

function pickEntry(entries: DriveFolderEntry[], fileId: string | undefined): DriveFolderEntry {
  const backups = recognizedBackups(entries);
  const entry =
    fileId === undefined ? backups[0] : backups.find((candidate) => candidate.id === fileId);
  if (!entry) {
    throw new RestoreError(
      fileId === undefined
        ? 'Tidak ada cadangan di folder cadangan'
        : 'Berkas cadangan dengan id itu tidak ditemukan di folder cadangan',
    );
  }
  return entry;
}

/**
 * Pemulihan cadangan dari Drive ke skema BARU: unduh (streaming), verifikasi MD5 Drive dan SHA-256 di
 * `appProperties`, gunzip penuh dan periksa kelengkapan dump, baru kemudian membuat skema dan mengimpor. Verifikasi
 * apa pun yang gagal menghentikan pemulihan SEBELUM skema disentuh. Skema target harus belum ada atau kosong dan tidak
 * boleh skema aplikasi; bila impor gagal, skema yang setengah terisi dibuang (impor DDL MariaDB tidak transaksional).
 */
export async function restoreBackup(
  deps: RestoreDeps,
  options: RestoreOptions,
): Promise<RestoreReport> {
  const { targetSchema } = options;
  if (!SCHEMA_PATTERN.test(targetSchema)) {
    throw new RestoreError('Nama skema target tidak valid (huruf, angka, _; maks. 64 karakter)');
  }
  if (options.compareWith !== undefined && !SCHEMA_PATTERN.test(options.compareWith)) {
    throw new RestoreError('Nama skema pembanding tidak valid');
  }
  if ((deps.protectedSchemas ?? []).includes(targetSchema)) {
    throw new RestoreError(
      'Skema target adalah skema aplikasi yang sedang dipakai; pilih skema baru',
    );
  }

  const entry = pickEntry(await listAllEntriesVia(deps.bridge, deps.folderId), options.fileId);
  const expectedSha = entry.appProperties.sha256;
  if (entry.md5Checksum === undefined || expectedSha === undefined) {
    throw new RestoreError(
      'Cadangan tanpa MD5 Drive atau SHA-256 tidak dapat diverifikasi; ditolak',
    );
  }

  await mkdir(deps.workDir, { recursive: true });
  const base = join(deps.workDir, entry.name);
  const gzPath = `${base}.download`;
  const sqlPath = `${base}.sql`;
  try {
    const download = await deps.bridge.downloadFile(entry.id, deps.folderId);
    if (download === null) throw new RestoreError('Berkas cadangan tidak dapat diunduh dari Drive');
    const digests = await downloadTo(download.body, gzPath);
    if (digests.md5 !== entry.md5Checksum || digests.size !== entry.size) {
      throw new RestoreError(
        'MD5/ukuran berkas unduhan tidak sama dengan yang tercatat di Drive; tidak ada yang diimpor',
      );
    }
    if (digests.sha256 !== expectedSha) {
      throw new RestoreError(
        'SHA-256 berkas unduhan tidak sama dengan yang tercatat saat unggah; tidak ada yang diimpor',
      );
    }
    await gunzipTo(gzPath, sqlPath);

    if (await deps.db.schemaExists(targetSchema)) {
      if ((await deps.db.tableNames(targetSchema)).length > 0) {
        throw new RestoreError(
          'Skema target sudah berisi tabel; pemulihan hanya ke skema baru atau kosong',
        );
      }
    } else {
      await deps.db.createSchema(targetSchema);
    }
    try {
      await deps.importSql(sqlPath, targetSchema);
    } catch (error) {
      await deps.db.dropSchema(targetSchema).catch(() => {});
      throw new RestoreError(
        `Impor gagal dan skema ${targetSchema} dibuang: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const tables: TableCount[] = [];
    const restoredTables = await deps.db.tableNames(targetSchema);
    const sourceTables =
      options.compareWith === undefined
        ? null
        : new Set(await deps.db.tableNames(options.compareWith));
    for (const table of restoredTables) {
      const restored = await deps.db.countRows(targetSchema, table);
      if (sourceTables === null || options.compareWith === undefined) {
        tables.push({ table, restored });
      } else {
        tables.push({
          table,
          restored,
          source: sourceTables.has(table)
            ? await deps.db.countRows(options.compareWith, table)
            : null,
        });
      }
    }
    const report: RestoreReport = {
      name: entry.name,
      driveId: entry.id,
      size: digests.size,
      md5: digests.md5,
      sha256: digests.sha256,
      schema: targetSchema,
      tables,
      dropped: false,
      ...(sourceTables === null
        ? {}
        : {
            matched:
              [...sourceTables].every((table) => restoredTables.includes(table)) &&
              tables.every((row) => row.source === row.restored),
          }),
    };
    if (options.dropAfter === true) {
      await deps.db.dropSchema(targetSchema);
      report.dropped = true;
    }
    return report;
  } finally {
    await rm(gzPath, { force: true });
    await rm(sqlPath, { force: true });
  }
}

/** Identifikator MariaDB yang aman di-backtick (nama sudah divalidasi `SCHEMA_PATTERN`/information_schema). */
function ident(name: string): string {
  if (!SCHEMA_PATTERN.test(name)) throw new RestoreError('Nama skema/tabel tidak valid');
  return `\`${name}\``;
}

/** `RestoreDb` nyata di atas adaptor `Db` (butuh hak CREATE/DROP DATABASE untuk skema target). */
export function createRestoreDb(db: Db): RestoreDb {
  return {
    async schemaExists(schema) {
      const row = await db
        .prepare('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?')
        .bind(schema)
        .first<{ n: number | string }>();
      return Number(row?.n ?? 0) > 0;
    },
    async tableNames(schema) {
      const rows = await db
        .prepare(
          "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        )
        .bind(schema)
        .all<{ name: string }>();
      return rows.results.map((row) => row.name);
    },
    async createSchema(schema) {
      await db.exec(
        `CREATE DATABASE ${ident(schema)} CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin`,
      );
    },
    async dropSchema(schema) {
      await db.exec(`DROP DATABASE IF EXISTS ${ident(schema)}`);
    },
    async countRows(schema, table) {
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${ident(schema)}.${ident(table)}`)
        .first<{ n: number | string }>();
      return Number(row?.n ?? 0);
    },
  };
}

/** Pengimpor nyata: klien `mariadb` membaca berkas .sql dari stdin; kata sandi lewat `MYSQL_PWD`, galat dibersihkan. */
export function createMariadbImporter(target: DumpTarget) {
  return async (sqlPath: string, schema: string): Promise<void> => {
    const proc = Bun.spawn(['mariadb', ...clientArgs(target), schema], {
      env: { MYSQL_PWD: target.password },
      stdin: Bun.file(sqlPath),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      const detail = redactSecrets(stderr.trim().slice(0, 500), target.password);
      throw new Error(`mariadb gagal (kode keluar ${code})${detail === '' ? '' : `: ${detail}`}`);
    }
  };
}

export interface RestoreArgs {
  targetSchema: string;
  fileId?: string;
  compareWith?: string;
  dropAfter: boolean;
}

export const RESTORE_USAGE = `Pemulihan cadangan dari Drive ke skema BARU.
  bun scripts/restore-backup.ts --target <skema> [--file-id <idDrive>] [--compare-with <skema>] [--drop-after]
    --target        skema tujuan (harus belum ada atau kosong; bukan skema aplikasi)
    --file-id       id berkas Drive; tanpa ini dipakai cadangan terbaru
    --compare-with  bandingkan jumlah baris per tabel dengan skema ini (kode keluar 1 bila beda)
    --drop-after    hapus skema target setelah selesai (uji pemulihan)
  Env opsional RESTORE_DATABASE_URL: URL mysql:// dengan hak CREATE/DROP DATABASE (bawaan DATABASE_URL).`;

/** Mengurai argumen CLI; `null` = salah pakai (cetak `RESTORE_USAGE`). */
export function parseRestoreArgs(argv: string[]): RestoreArgs | null {
  const values: Record<string, string> = {};
  let dropAfter = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--drop-after') {
      dropAfter = true;
    } else if (['--target', '--file-id', '--compare-with'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return null;
      values[arg] = value;
      index += 1;
    } else {
      return null;
    }
  }
  const targetSchema = values['--target'];
  if (targetSchema === undefined) return null;
  return {
    targetSchema,
    dropAfter,
    ...(values['--file-id'] === undefined ? {} : { fileId: values['--file-id'] }),
    ...(values['--compare-with'] === undefined ? {} : { compareWith: values['--compare-with'] }),
  };
}
