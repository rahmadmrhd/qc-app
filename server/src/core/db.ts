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

export interface Db {
  prepare(sql: string): DbStatement;
  /** Semua pernyataan dalam satu transaksi (BEGIN ... COMMIT); gagal -> ROLLBACK. Deadlock diulang sekali. */
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>;
  /** Banyak pernyataan sekaligus (koneksi khusus). HANYA untuk SQL tepercaya milik migrator dan harness tes. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Pencacah ringan untuk mengukur beban basis data di tes/skrip: pemanggilan Db (round trip), pernyataan. */
export interface DbStats {
  /** Pemanggilan `run/all/first` (1 per pernyataan tunggal) dan `batch` (1 per batch). */
  trips: number;
  statements: number;
  /** Bila diisi, setiap SQL yang dijalankan ditambahkan (untuk pemeriksaan kueri). */
  log: string[] | null;
}

const statsByDb = new WeakMap<Db, DbStats>();

export function dbStatsOf(db: Db): DbStats {
  const stats = statsByDb.get(db);
  if (!stats) throw new Error('dbStatsOf: bukan Db hasil createDb');
  return stats;
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
    const m = /for key '([^']+)'/.exec(message);
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

const CONNECT_TIMEOUT_MS = 4000;
const SESSION_COLLATION = 'SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin';

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
  });

  const stats: DbStats = { trips: 0, statements: 0, log: null };
  const count = (sql: string, trips: number) => {
    stats.trips += trips;
    stats.statements += 1;
    stats.log?.push(sql);
  };
  const poolRunner = (sql: string, values: unknown[]) => {
    count(sql, 1);
    return execute(pool as unknown as Executor, sql, values);
  };

  const batchOnce = async (statements: Statement[]): Promise<DbResult[]> => {
    const conn = await pool.getConnection();
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

  const db: Db = {
    prepare: (sql) => new Statement(sql, [], poolRunner),

    async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
      const list = statements.map((s) => {
        if (!(s instanceof Statement))
          throw new TypeError('batch hanya menerima pernyataan dari Db.prepare() ini');
        return s;
      });
      stats.trips += 1;
      for (const s of list) count(s.sql, 0);
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
        conn = await mysql.createConnection({ ...base, multipleStatements: true });
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
  statsByDb.set(db, stats);
  return db;
}
