import { Database, type SQLQueryBindings } from 'bun:sqlite';

/** Batas D1: parameter terikat per pernyataan. */
export const D1_MAX_BOUND_PARAMETERS = 100;

type Row = Record<string, unknown>;

interface Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
  changed_db: boolean;
  size_after: number;
  served_by: string;
}

function toBinding(value: unknown): SQLQueryBindings {
  if (value === undefined) throw new Error('D1_TYPE_ERROR: Type "undefined" not supported');
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as SQLQueryBindings;
}

function buildMeta(db: Database, started: number, rows: number): Meta {
  const info = db.query('SELECT changes() AS c, last_insert_rowid() AS r').get() as {
    c: number;
    r: number;
  };
  return {
    duration: performance.now() - started,
    changes: info.c,
    last_row_id: info.r,
    rows_read: rows,
    rows_written: info.c,
    changed_db: info.c > 0,
    size_after: 0,
    served_by: 'sqlite-d1',
  };
}

/** Pencacah ringan untuk mengukur beban D1 di tes/skrip: round trip, pernyataan, baris dikembalikan. */
export interface D1Stats {
  trips: number;
  statements: number;
  rows: number;
  /** Bila diisi, setiap SQL yang dijalankan ditambahkan (untuk pemeriksaan rencana kueri). */
  log: string[] | null;
}

class SqliteStatement {
  constructor(
    private readonly db: Database,
    readonly sql: string,
    readonly params: SQLQueryBindings[] = [],
    private readonly stats: D1Stats = { trips: 0, statements: 0, rows: 0, log: null },
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    if (values.length > D1_MAX_BOUND_PARAMETERS) {
      throw new Error(
        `D1_ERROR: too many SQL variables (${values.length}); batas ${D1_MAX_BOUND_PARAMETERS} parameter terikat per kueri`,
      );
    }
    return new SqliteStatement(this.db, this.sql, values.map(toBinding), this.stats);
  }

  /** Dipakai `batch`: jalankan tanpa membuka transaksi sendiri. */
  execute(): { results: Row[]; success: true; meta: Meta } {
    const started = performance.now();
    const stmt = this.db.query(this.sql);
    const results = stmt.all(...this.params) as Row[];
    this.stats.statements++;
    this.stats.rows += results.length;
    this.stats.log?.push(this.sql);
    return { results, success: true, meta: buildMeta(this.db, started, results.length) };
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: Meta }> {
    this.stats.trips++;
    return this.execute() as { results: T[]; success: true; meta: Meta };
  }

  async run<T = Row>(): Promise<{ results: T[]; success: true; meta: Meta }> {
    this.stats.trips++;
    return this.execute() as { results: T[]; success: true; meta: Meta };
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    this.stats.trips++;
    const row = this.execute().results[0];
    if (row === undefined) return null;
    if (column !== undefined) {
      if (!(column in row)) throw new Error(`D1_ERROR: no such column: ${column}`);
      return row[column] as T;
    }
    return row as T;
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const stmt = this.db.query(this.sql);
    const rows = stmt.values(...this.params) as unknown[][];
    if (options?.columnNames) return [stmt.columnNames as unknown, ...rows] as T[];
    return rows as T[];
  }
}

/**
 * D1 palsu di atas `bun:sqlite` untuk tes. Meniru permukaan yang dipakai Worker:
 * prepare/bind/first/all/run/raw, `batch` (transaksi atomik) dan `exec`, serta batas
 * 100 parameter terikat per pernyataan dan penegakan foreign key seperti D1.
 */
export function createSqliteD1(): D1Database {
  const db = new Database(':memory:');
  const stats: D1Stats = { trips: 0, statements: 0, rows: 0, log: null };
  db.exec('PRAGMA foreign_keys = ON');

  const d1 = {
    stats,
    prepare: (sql: string) => new SqliteStatement(db, sql, [], stats),
    async batch(statements: SqliteStatement[]) {
      stats.trips++;
      db.exec('BEGIN');
      try {
        const out = statements.map((statement) => statement.execute());
        db.exec('COMMIT');
        return out;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql: string) {
      stats.trips++;
      const started = performance.now();
      db.exec(sql);
      return {
        count: sql.split('\n').filter((l) => l.trim() !== '').length,
        duration: performance.now() - started,
      };
    },
    withSession() {
      return d1;
    },
    async dump(): Promise<ArrayBuffer> {
      throw new Error('dump tidak didukung adaptor tes');
    },
  };
  return d1 as unknown as D1Database;
}

/** Pencacah D1 dari `createSqliteD1`; ada pada env uji (`createTestEnv`). */
export function d1StatsOf(db: D1Database): D1Stats {
  return (db as unknown as { stats: D1Stats }).stats;
}
