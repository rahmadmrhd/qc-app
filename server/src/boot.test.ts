// Persiapan basis data saat start (cek koneksi + migrasi) terhadap MariaDB nyata lewat tunnel.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createDb, type Db } from '@server/core/db';
import { loadMigrations } from '@server/core/migrate';
import { newTestSchemaName, testDbUrl } from '@server-test/db-env';
import { prepareDatabase, StartupError } from './boot';
import { loadConfig } from './config';
import { createServer } from './server';

let admin: Db;
const schemas: string[] = [];
const opened: Db[] = [];

async function freshDb(): Promise<Db> {
  const name = newTestSchemaName();
  schemas.push(name);
  await admin.exec(`CREATE DATABASE \`${name}\``);
  const db = createDb({ url: testDbUrl(), database: name, connectionLimit: 3 });
  opened.push(db);
  return db;
}

beforeAll(() => {
  admin = createDb({ url: testDbUrl(), connectionLimit: 2 });
});

afterAll(async () => {
  for (const db of opened) await db.close();
  for (const name of schemas) await admin.exec(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.close();
});

const recorded = async (db: Db) =>
  (await db.prepare('SELECT name FROM schema_migrations ORDER BY name').all<{ name: string }>())
    .results;

describe('prepareDatabase', () => {
  test('skema kosong: semua migrasi diterapkan dan dicatat; panggilan ulang tidak menerapkan apa pun', async () => {
    const db = await freshDb();
    const all = (await loadMigrations()).map((m) => m.name);
    expect(all.length).toBeGreaterThan(0);
    expect(await prepareDatabase(db)).toEqual(all);
    expect((await recorded(db)).map((r) => r.name)).toEqual(all);
    expect(await prepareDatabase(db)).toEqual([]);
    expect((await recorded(db)).map((r) => r.name)).toEqual(all);
  });

  test('migrasi yang gagal: StartupError tahap migrate (gagal cepat), tidak dicatat, migrasi sebelumnya tetap', async () => {
    const db = await freshDb();
    const migrations = [
      { name: '0001_ok.sql', sql: 'CREATE TABLE IF NOT EXISTS t_ok (id INT) ENGINE=InnoDB' },
      { name: '0002_rusak.sql', sql: 'CREATE TABLE t_rusak (id INT, ) ENGINE=InnoDB' },
      { name: '0003_tak_tercapai.sql', sql: 'CREATE TABLE IF NOT EXISTS t_x (id INT)' },
    ];
    const error = await prepareDatabase(db, migrations).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StartupError);
    expect((error as StartupError).stage).toBe('migrate');
    expect((error as StartupError).message).toContain('0002_rusak.sql');
    expect((await recorded(db)).map((r) => r.name)).toEqual(['0001_ok.sql']);
  });

  test('basis data tidak terjangkau: StartupError tahap connect', async () => {
    // port 1 di loopback: ditolak seketika, tanpa menyentuh MariaDB tes
    const dead = createDb({ url: 'mysql://x:y@127.0.0.1:1/tidak_ada', connectionLimit: 1 });
    try {
      const error = await prepareDatabase(dead).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).stage).toBe('connect');
    } finally {
      await dead.close();
    }
  });
});

describe('createServer: runner dan penjadwal menunggu persiapan basis data', () => {
  const baseEnv = {
    DATABASE_URL: 'mysql://tidak-dipakai:x@127.0.0.1:1/tidak_ada',
    SESSION_SECRET: 'test-session-secret',
    OAUTH_CLIENT_ID: 'id',
    OAUTH_CLIENT_SECRET: 'rahasia',
    SYNC_API_TOKEN: 'token-sinkron-uji-cukup-panjang',
    BRIDGE_URL: 'https://bridge.test/exec',
    BRIDGE_SECRET: 'rahasia-jembatan',
    ADMIN_EMAIL: 'admin@example.com',
  };

  test('skema kosong: tidak ada putaran latar yang gagal karena tabel belum ada (migrasi selesai dulu)', async () => {
    const db = await freshDb();
    const errors: string[] = [];
    const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      const server = createServer(loadConfig(baseEnv), { db, prepare: prepareDatabase });
      await server.ready;
      await new Promise((resolve) => setTimeout(resolve, 1_500)); // beberapa tick runner/penjadwal
      await server.stop();
      expect(errors.filter((line) => line.includes('putaran gagal'))).toEqual([]);
      expect((await recorded(db)).length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);

  test('persiapan gagal: ready menolak, runner/penjadwal tidak pernah dijalankan, stop() tetap selesai', async () => {
    const db = await freshDb();
    const errors: string[] = [];
    const spy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    try {
      const server = createServer(loadConfig(baseEnv), {
        db,
        prepare: () => Promise.reject(new Error('migrasi rusak')),
      });
      await expect(server.ready).rejects.toThrow('migrasi rusak');
      await new Promise((resolve) => setTimeout(resolve, 500));
      await server.stop();
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});
