import mysql from 'mysql2/promise';

export interface DbResult<T = unknown> {
  results: T[];
  meta: { changes: number; lastRowId: number };
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<DbResult<T>>;
  run(): Promise<DbResult>;
}

/** Pembuat pernyataan; `Db` dan `DbTx` memenuhinya (pembangun pernyataan menerima keduanya). */
export interface Preparer {
  prepare(sql: string): DbStatement;
}

/**
 * Transaksi interaktif: pernyataan dari `prepare` berjalan di SATU koneksi di dalam transaksi (boleh membaca di
 * tengah transaksi, mis. `SELECT ... FOR UPDATE`, lalu menulis). Hanya berlaku selama callback `Db.transaction`.
 */
export type DbTx = Preparer;

export interface Db extends Preparer {
  /** Semua pernyataan dalam satu transaksi (BEGIN ... COMMIT); gagal -> ROLLBACK. Deadlock diulang sekali. */
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>;
  /**
   * Jalankan `fn` dalam satu transaksi (BEGIN ... COMMIT); galat apa pun dari `fn` -> ROLLBACK dan galat dilempar
   * ulang (sebagai `DbError` untuk galat basis data). Deadlock (1213) mengulang `fn` SEKALI dari awal, jadi `fn`
   * hanya boleh punya efek di dalam transaksi (tanpa efek samping di luar basis data).
   */
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  /** Banyak pernyataan sekaligus (koneksi khusus). HANYA untuk SQL tepercaya milik migrator dan harness tes. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export type DbErrorKind = 'duplicate' | 'out_of_range' | 'deadlock' | 'unavailable' | 'other';

export interface DbErrorInit {
  errno: number;
  kind: DbErrorKind;
  key?: string;
  cause?: unknown;
}

export class DbError extends Error {
  errno: number;
  kind: DbErrorKind;
  key?: string;

  constructor(message: string, init: DbErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'DbError';
    this.errno = init.errno;
    this.kind = init.kind;
    if (init.key !== undefined) this.key = init.key;
  }
}

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST',
]);

const ER_DUP_ENTRY = 1062;
const ER_DEADLOCK = 1213;
const ER_LOCK_WAIT_TIMEOUT = 1205;
const ER_DATA_OUT_OF_RANGE = 1690;

const UNAVAILABLE_HINT =
  'Database tidak terjangkau. Pastikan MariaDB berjalan (dev/test: jalankan `bun run db:tunnel` di terminal lain).';

interface RawError {
  errno?: unknown;
  code?: unknown;
  message?: unknown;
  errors?: unknown;
}

/** Menerjemahkan galat driver menjadi DbError bertipe. DbError dikembalikan apa adanya. */
export function toDbError(err: unknown): DbError {
  if (err instanceof DbError) return err;
  const raw = (err ?? {}) as RawError;
  let code = typeof raw.code === 'string' ? raw.code : undefined;
  if (!code && Array.isArray(raw.errors)) {
    // AggregateError (mis. koneksi dual-stack gagal ke semua alamat)
    const inner = (raw.errors as RawError[]).find((e) => typeof e?.code === 'string');
    code = inner?.code as string | undefined;
  }
  const message = typeof raw.message === 'string' ? raw.message : String(err);
  const errno = typeof raw.errno === 'number' ? raw.errno : 0;

  if (code && UNAVAILABLE_CODES.has(code)) {
    return new DbError(`${UNAVAILABLE_HINT} (${code})`, { errno, kind: 'unavailable', cause: err });
  }
  if (errno === ER_DUP_ENTRY) {
    // Pesan = `Duplicate entry '<nilai>' for key '<indeks>'`: nilai berisi teks bebas, jadi nama indeks diambil dari
    // ujung pesan (terjangkar `$`), bukan kecocokan pertama.
    const m = /for key '([^']+)'$/.exec(message);
    const key = m?.[1]?.split('.').pop();
    return new DbError(
      message,
      key
        ? { errno, kind: 'duplicate', key, cause: err }
        : { errno, kind: 'duplicate', cause: err },
    );
  }
  if (errno === ER_DATA_OUT_OF_RANGE)
    return new DbError(message, { errno, kind: 'out_of_range', cause: err });
  if (errno === ER_DEADLOCK || errno === ER_LOCK_WAIT_TIMEOUT) {
    return new DbError(message, { errno, kind: 'deadlock', cause: err });
  }
  return new DbError(message, { errno, kind: 'other', cause: err });
}

export interface DbConfig {
  /** mysql://user:pass@host:port/ atau .../nama_db. Tanpa nama database = tanpa database terpilih. */
  url: string;
  connectionLimit?: number;
  /** Menimpa nama database dari URL. */
  database?: string;
}

const CONNECT_TIMEOUT_MS = 10_000;
const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY_MS = 300;
const SESSION_COLLATION = 'SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin';
/**
 * MariaDB >= 11.6.2 menyalakan `innodb_snapshot_isolation` (bawaan): pada REPEATABLE READ, menulis/mengunci baris yang
 * diubah transaksi lain SETELAH snapshot transaksi ini dibuat melempar galat 1020 ("Record has changed since last
 * read"). Penghitung bersama (`counters`) dan penulisan setelah baca biasa akan sering kena. Dimatikan
 * per sesi: bacaan biasa tetap konsisten, pembacaan/penulisan mengunci tetap melihat data terbaru (perilaku MySQL).
 */
const SESSION_SNAPSHOT_OFF = 'SET SESSION innodb_snapshot_isolation = 0';

/** Galat saat MEMBUKA koneksi (syscall connect): belum ada pernyataan yang dikirim, jadi aman diulang. */
function isConnectFailure(err: unknown): boolean {
  const e = err as { syscall?: unknown; code?: unknown };
  return e?.syscall === 'connect' && (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET');
}

/** Mengulang pekerjaan yang gagal hanya saat koneksi gagal dibuka (tunnel/jaringan kadang menolak sesaat). */
async function retryConnect<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      if (attempt >= CONNECT_ATTEMPTS || !isConnectFailure(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS * attempt));
    }
  }
}

function connectionOptions(config: DbConfig) {
  const u = new URL(config.url);
  const fromPath = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const database = config.database ?? (fromPath || undefined);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ...(database ? { database } : {}),
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    jsonStrings: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
  };
}

type BindValue = string | number | bigint | boolean | null | Date | Uint8Array;

/**
 * INVARIAN KEAMANAN: mysql2 `query(sql, values)` mengganti `?` di SISI KLIEN (bukan prepared statement server) dengan
 * nilai yang di-escape; benarnya escaping itu bergantung pada `sql_mode` server. `NO_BACKSLASH_ESCAPES` DILARANG
 * di `sql_mode` (lihat deploy/mariadb/qc.cnf): dengan mode itu escaping `\'` mysql2 tidak lagi benar dan terbuka
 * injeksi SQL. `checkBindValue` menolak objek/larik, dan pool dibuat tanpa `multipleStatements`.
 */
function checkBindValue(v: unknown, index: number): BindValue {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'bigint' || t === 'boolean') return v as BindValue;
  if (v instanceof Date || v instanceof Uint8Array) return v;
  throw new TypeError(
    `Nilai bind #${index + 1} bertipe ${v === undefined ? 'undefined' : 'objek/larik'}: gunakan null, string (JSON.stringify untuk JSON), angka, bigint, boolean, Date, atau bytes.`,
  );
}

interface Executor {
  query(sql: string, values: unknown[]): Promise<[unknown, unknown]>;
}

async function execute(executor: Executor, sql: string, values: unknown[]): Promise<DbResult> {
  const [res] = await executor.query(sql, values);
  if (Array.isArray(res)) return { results: res, meta: { changes: 0, lastRowId: 0 } };
  const header = (res ?? {}) as { affectedRows?: number; insertId?: number };
  return {
    results: [],
    meta: { changes: header.affectedRows ?? 0, lastRowId: header.insertId ?? 0 },
  };
}

class Statement implements DbStatement {
  constructor(
    readonly sql: string,
    readonly values: BindValue[],
    private readonly runner: (sql: string, values: unknown[]) => Promise<DbResult>,
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new Statement(this.sql, values.map(checkBindValue), this.runner);
  }

  async run(): Promise<DbResult> {
    try {
      return await this.runner(this.sql, this.values);
    } catch (err) {
      throw toDbError(err);
    }
  }

  async all<T = unknown>(): Promise<DbResult<T>> {
    return (await this.run()) as DbResult<T>;
  }

  async first<T = unknown>(): Promise<T | null> {
    const res = await this.run();
    return (res.results[0] as T | undefined) ?? null;
  }
}

/** Galat dari driver mysql2/jaringan (punya `errno` numerik); selain itu galat aplikasi yang tak boleh dibungkus. */
function isDriverError(err: Error): boolean {
  return (
    err instanceof DbError ||
    err instanceof AggregateError ||
    typeof (err as { errno?: unknown }).errno === 'number'
  );
}

export function createDb(config: DbConfig): Db {
  const base = connectionOptions(config);
  const pool = mysql.createPool({
    ...base,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: config.connectionLimit ?? 10,
  });
  // Kolasi sesi sama dengan server (utf8mb4_nopad_bin) agar literal ikut membedakan spasi ekor.
  pool.pool.on('connection', (conn) => {
    conn.query(SESSION_COLLATION, () => {});
    conn.query(SESSION_SNAPSHOT_OFF, () => {});
  });

  const poolRunner = (sql: string, values: unknown[]) =>
    retryConnect(() => execute(pool as unknown as Executor, sql, values));

  const batchOnce = async (statements: Statement[]): Promise<DbResult[]> => {
    const conn = await retryConnect(() => pool.getConnection());
    try {
      await conn.beginTransaction();
      try {
        const out: DbResult[] = [];
        for (const s of statements)
          out.push(await execute(conn as unknown as Executor, s.sql, s.values));
        await conn.commit();
        return out;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      }
    } finally {
      conn.release();
    }
  };

  const transactionOnce = async <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> => {
    const conn = await retryConnect(() => pool.getConnection());
    try {
      await conn.beginTransaction();
      const tx: DbTx = {
        prepare: (sql) =>
          new Statement(sql, [], (text, values) =>
            execute(conn as unknown as Executor, text, values),
          ),
      };
      try {
        const out = await fn(tx);
        await conn.commit();
        return out;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      }
    } finally {
      conn.release();
    }
  };

  const db: Db = {
    prepare: (sql) => new Statement(sql, [], poolRunner),

    async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await transactionOnce(fn);
        } catch (err) {
          const e = toDbError(err);
          if (e.kind === 'deadlock' && e.errno === ER_DEADLOCK && attempt === 0) continue;
          // Galat aplikasi (mis. AppError) dilempar apa adanya; hanya galat driver yang dibungkus.
          throw err instanceof Error && !isDriverError(err) ? err : e;
        }
      }
    },

    async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
      const list = statements.map((s) => {
        if (!(s instanceof Statement))
          throw new TypeError('batch hanya menerima pernyataan dari Db.prepare() ini');
        return s;
      });
      for (let attempt = 0; ; attempt++) {
        try {
          return (await batchOnce(list)) as DbResult<T>[];
        } catch (err) {
          const e = toDbError(err);
          if (e.kind === 'deadlock' && e.errno === ER_DEADLOCK && attempt === 0) continue;
          throw e;
        }
      }
    },

    async exec(sql) {
      let conn: mysql.Connection | undefined;
      try {
        // Membuka koneksi aman diulang (belum ada yang dijalankan); jaringan/tunnel kadang menolak sesaat.
        for (let attempt = 1; ; attempt++) {
          try {
            conn = await mysql.createConnection({ ...base, multipleStatements: true });
            break;
          } catch (err) {
            if (attempt >= CONNECT_ATTEMPTS || toDbError(err).kind !== 'unavailable') throw err;
            await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS * attempt));
          }
        }
        await conn.query(sql);
      } catch (err) {
        throw toDbError(err);
      } finally {
        await conn?.end().catch(() => {});
      }
    },

    async close() {
      await pool.end();
    },
  };
  return db;
}
