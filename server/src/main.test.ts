// Titik masuk `main.ts` sebagai PROSES nyata: migrasi dijalankan sebelum mendengarkan, dan kegagalan start keluar
// kode 1 tanpa membuka port. Anak proses memakai skema MariaDB sementara (tunnel) dan port acak.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from '@server/core/db';
import { loadMigrations } from '@server/core/migrate';
import { newTestSchemaName, testDbUrl } from '@server-test/db-env';

const MAIN = join(import.meta.dir, 'main.ts');
const START_TIMEOUT_MS = 25_000;

let admin: Db;
const schemas: string[] = [];

beforeAll(() => {
  admin = createDb({ url: testDbUrl(), connectionLimit: 2 });
});

afterAll(async () => {
  for (const name of schemas) await admin.exec(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.close();
});

async function emptySchema(): Promise<string> {
  const name = newTestSchemaName();
  schemas.push(name);
  await admin.exec(`CREATE DATABASE \`${name}\``);
  return name;
}

function databaseUrlFor(schema: string): string {
  const url = new URL(testDbUrl());
  url.pathname = `/${schema}`;
  return url.toString();
}

/** Variabel konfigurasi server yang dikosongkan dari lingkungan pengembang agar anak proses deterministik. */
const SCRUBBED = [
  'DATABASE_URL',
  'APP_ORIGIN',
  'DEV_LOGIN_EMAIL',
  'NODE_ENV',
  'TRUSTED_PROXY',
  'STATIC_DIR',
  'DB_POOL_SIZE',
];

/**
 * Lingkungan anak proses: lingkungan saat ini (Windows butuh variabel sistem agar soket jalan) tanpa variabel
 * konfigurasi server di atas; cwd di luar server/ agar `server/.env` tak termuat.
 */
function childEnv(overrides: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SCRUBBED.includes(key)) base[key] = value;
  }
  return {
    ...base,
    SESSION_SECRET: 'rahasia-sesi-uji-cukup-panjang',
    OAUTH_CLIENT_ID: 'id',
    OAUTH_CLIENT_SECRET: 'rahasia',
    SYNC_API_TOKEN: 'token-sinkron-uji-cukup-panjang',
    ADMIN_EMAIL: 'admin@example.com',
    HOST: '127.0.0.1',
    PORT: String(20000 + Math.floor(Math.random() * 20000)),
    ...overrides,
  };
}

function spawnMain(env: Record<string, string>) {
  return Bun.spawn([process.execPath, MAIN], {
    cwd: tmpdir(),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

/** Tunggu sampai stdout memuat `evt: "start"` (server mendengarkan), proses keluar, atau waktu habis; kembalikan keluaran sejauh itu. */
async function waitForStart(proc: ReturnType<typeof spawnMain>): Promise<string> {
  const decoder = new TextDecoder();
  let out = '';
  const deadline = Date.now() + START_TIMEOUT_MS;
  const reading = (async () => {
    for await (const chunk of proc.stdout) {
      out += decoder.decode(chunk, { stream: true });
    }
  })();
  while (Date.now() < deadline && !out.includes('"start"')) {
    const ended = await Promise.race([
      reading.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
    ]);
    if (ended) break;
  }
  return out;
}

async function stop(proc: ReturnType<typeof spawnMain>): Promise<void> {
  proc.kill();
  await proc.exited;
}

describe('main.ts (proses nyata)', () => {
  test('menjalankan migrasi pada skema kosong SEBELUM mendengarkan, lalu melayani /api/ping', async () => {
    const schema = await emptySchema();
    const env = childEnv({ DATABASE_URL: databaseUrlFor(schema) });
    const proc = spawnMain(env);
    try {
      const out = await waitForStart(proc);
      expect(out).toContain('"start"');
      const db = createDb({ url: testDbUrl(), database: schema, connectionLimit: 1 });
      try {
        const rows = await db
          .prepare('SELECT name FROM schema_migrations ORDER BY name')
          .all<{ name: string }>();
        expect(rows.results.map((r) => r.name)).toEqual(
          (await loadMigrations()).map((m) => m.name),
        );
      } finally {
        await db.close();
      }
      const ping = await fetch(`http://127.0.0.1:${env.PORT}/api/ping`);
      expect(ping.status).toBe(200);
    } finally {
      await stop(proc);
    }
  }, 60_000);

  test('MariaDB tak terjangkau: keluar kode 1 dengan pesan, tanpa mendengarkan', async () => {
    const env = childEnv({ DATABASE_URL: 'mysql://x:y@127.0.0.1:1/tidak_ada' });
    const proc = spawnMain(env);
    const code = await Promise.race([
      proc.exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), START_TIMEOUT_MS)),
    ]);
    if (code === 'timeout') await stop(proc);
    expect(code).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain('Basis data tidak terjangkau');
    const reachable = await fetch(`http://127.0.0.1:${env.PORT}/api/ping`).then(
      () => true,
      () => false,
    );
    expect(reachable).toBe(false);
  }, 60_000);

  test('TRUSTED_PROXY rusak: keluar kode 1 menyebut variabelnya, tanpa menyentuh basis data', async () => {
    const env = childEnv({
      DATABASE_URL: 'mysql://x:y@127.0.0.1:1/tidak_ada',
      TRUSTED_PROXY: 'bukan-cidr',
    });
    const proc = spawnMain(env);
    const code = await proc.exited;
    expect(code).toBe(1);
    const err = await new Response(proc.stderr).text();
    expect(err).toContain('TRUSTED_PROXY');
    expect(err).not.toContain('bukan-cidr');
  }, 60_000);
});
