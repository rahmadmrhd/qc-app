import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { redactSecrets } from '@server/core/redact';
import { parseBackupName } from './names';

/** Jumlah salinan dump yang disimpan di VPS (volume lokal). */
export const LOCAL_BACKUP_KEEP = 3;
/** Batas paket sisi klien; server MariaDB membatasi 16 MiB (`max_allowed_packet`). */
export const DUMP_MAX_ALLOWED_PACKET = '256M';
/** Ekor keluaran dump yang diperiksa untuk baris penutup "-- Dump completed". */
const TAIL_BYTES = 1024;
const STDERR_LIMIT = 500;

export interface DumpTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Proses anak yang dibutuhkan pembangkit dump (`Bun.spawn` nyata atau tiruan tes). */
export interface DumpProcess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

/** `env` = SELURUH lingkungan anak (hanya `MYSQL_PWD`): kata sandi tidak pernah lewat argumen baris perintah. */
export type SpawnFn = (command: string[], env: Record<string, string>) => DumpProcess;

export interface DumpDeps {
  spawn?: SpawnFn;
  /** Biner klien (bawaan `mariadb-dump`). */
  bin?: string;
}

/**
 * Mengurai `mysql://pengguna:kata-sandi@host:port[/skema]` (galat tanpa memuat URL: ada kata sandi di dalamnya).
 * `name` = nama variabel lingkungan yang disebut di pesan galat. `requireDatabase: false` menerima URL tingkat
 * server tanpa nama basis data (`database` = ''): dipakai `RESTORE_DATABASE_URL` pengguna pemulihan terbatas, yang
 * tak punya skema bawaan (skema target diberikan CLI secara posisional dan tak pernah dibaca dari URL).
 */
export function parseMysqlUrl(
  databaseUrl: string,
  options: { name?: string; requireDatabase?: boolean } = {},
): DumpTarget {
  const name = options.name ?? 'DATABASE_URL';
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(`${name} bukan URL yang valid`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    url.protocol !== 'mysql:' ||
    url.hostname === '' ||
    (options.requireDatabase !== false && database === '')
  ) {
    throw new Error(
      `${name} harus berbentuk mysql://pengguna:kata-sandi@host:port${options.requireDatabase === false ? '[/skema]' : '/skema'}`,
    );
  }
  return {
    host: url.hostname,
    port: url.port === '' ? 3306 : Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/** URL aplikasi (`DATABASE_URL`): nama basis data wajib. */
export function parseDatabaseUrl(databaseUrl: string): DumpTarget {
  return parseMysqlUrl(databaseUrl);
}

/**
 * Argumen klien `mariadb-dump`/`mariadb` tanpa kata sandi (itu lewat env `MYSQL_PWD`). `--skip-ssl`: lalu lintas
 * hanya di jaringan Docker internal ke `qc-db` yang tak punya sertifikat (klien 11.x memverifikasi TLS secara
 * bawaan dan menolak tanpa ini).
 */
export function clientArgs(target: DumpTarget): string[] {
  return [
    `--host=${target.host}`,
    `--port=${target.port}`,
    `--user=${target.user}`,
    '--skip-ssl',
    `--max-allowed-packet=${DUMP_MAX_ALLOWED_PACKET}`,
    '--default-character-set=utf8mb4',
  ];
}

/**
 * Argumen `mariadb-dump`. Nama basis data POSISIONAL (bukan `--databases`): dump tidak memuat `CREATE DATABASE`
 * atau `USE`, jadi pemulihan ke skema lain tidak pernah menimpa skema sumber.
 */
export function dumpArgs(target: DumpTarget): string[] {
  return [
    ...clientArgs(target),
    '--single-transaction',
    '--routines',
    '--hex-blob',
    target.database,
  ];
}

/** Pembangkit nyata: `Bun.spawn` dengan lingkungan anak yang hanya memuat kata sandi. */
export const bunSpawn: SpawnFn = (command, env) => {
  const proc = Bun.spawn(command, { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    exited: proc.exited,
  };
};

export async function readLimited(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    if (text.length < STDERR_LIMIT) text += decoder.decode(value, { stream: true });
  }
}

/**
 * Menjalankan `mariadb-dump`, memampatkan keluarannya (gzip, streaming) ke `<outputPath>.partial`, lalu
 * mengganti namanya menjadi `outputPath` HANYA bila kode keluar 0 dan keluaran berakhir dengan baris penutup
 * "-- Dump completed" (dump yang mati di tengah tetap menghasilkan gzip valid berisi SQL terpotong). Gagal = tak
 * ada berkas jadi dan `.partial` dibuang; galat tidak memuat kata sandi.
 */
export async function runDump(
  target: DumpTarget,
  outputPath: string,
  deps: DumpDeps = {},
): Promise<void> {
  const spawn = deps.spawn ?? bunSpawn;
  const partial = `${outputPath}.partial`;
  let tail = '';
  const tracker = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      tail = (tail + chunk.toString('latin1')).slice(-TAIL_BYTES);
      callback(null, chunk);
    },
  });
  // Jalur absolut dicari di PATH proses induk: lingkungan anak sengaja hanya berisi MYSQL_PWD.
  const proc = spawn(
    [deps.bin ?? Bun.which('mariadb-dump') ?? 'mariadb-dump', ...dumpArgs(target)],
    {
      MYSQL_PWD: target.password,
    },
  );
  const stderrPromise = readLimited(proc.stderr);
  let failure: Error | null = null;
  try {
    await pipeline(
      Readable.fromWeb(proc.stdout as import('node:stream/web').ReadableStream),
      tracker,
      createGzip(),
      createWriteStream(partial, { mode: 0o600 }),
    );
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  const exitCode = await proc.exited;
  const stderr = redactSecrets((await stderrPromise).trim(), target.password);
  if (failure === null && exitCode !== 0) {
    failure = new Error(
      `mariadb-dump gagal (kode keluar ${exitCode})${stderr === '' ? '' : `: ${stderr}`}`,
    );
  } else if (failure === null && !/-- Dump completed/.test(tail)) {
    failure = new Error(
      'Keluaran mariadb-dump tidak lengkap (baris penutup "Dump completed" tidak ada)',
    );
  }
  if (failure !== null) {
    await unlink(partial).catch(() => {});
    throw new Error(redactSecrets(failure.message, target.password));
  }
  await rename(partial, outputPath);
}

/** Pembangkit dump nyata untuk `Env.BACKUP_DUMP`. */
export function createMariadbDumpRunner(
  target: DumpTarget,
  deps: DumpDeps = {},
): (outputPath: string) => Promise<void> {
  return (outputPath) => runDump(target, outputPath, deps);
}

export interface FileDigest {
  md5: string;
  sha256: string;
  size: number;
}

/** MD5, SHA-256, dan ukuran berkas, dibaca streaming (memori konstan). */
export async function fileDigest(path: string): Promise<FileDigest> {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    md5.update(chunk);
    sha256.update(chunk);
    size += chunk.length;
  }
  return { md5: md5.digest('hex'), sha256: sha256.digest('hex'), size };
}

/**
 * Menyisakan `keep` salinan dump terbaru (menurut nama) di folder lokal; membuang sisanya dan semua `.partial`
 * cadangan. Berkas lain tidak disentuh. Mengembalikan nama yang dibuang. Folder belum ada = tidak melakukan apa-apa.
 */
export async function pruneLocalDumps(dir: string, keep: number): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const partials = names.filter(
    (name) =>
      name.endsWith('.partial') && parseBackupName(name.slice(0, -'.partial'.length)) !== null,
  );
  const dumps = names
    .flatMap((name) => {
      const parsed = parseBackupName(name);
      return parsed === null ? [] : [{ name, key: parsed.key }];
    })
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const doomed = [...partials, ...dumps.slice(keep).map((dump) => dump.name)];
  for (const name of doomed) await unlink(join(dir, name)).catch(() => {});
  return doomed;
}

/** Memastikan folder lokal cadangan ada. */
export async function ensureLocalDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}
