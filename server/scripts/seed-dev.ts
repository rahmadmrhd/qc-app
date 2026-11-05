import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseDevVars } from './dev-vars';
import { buildSeedSql } from './seed-data';

const WORKER_DIR = resolve(import.meta.dir, '..');
const SQL_FILE = join(WORKER_DIR, '.wrangler', 'seed-dev.sql');

export interface SeedArgs {
  email?: string;
}

/**
 * Argumen skrip. Skrip ini HANYA untuk D1 lokal: `--remote` (dan bentuk pendeknya `-r`, serta `--preview`)
 * DITOLAK dengan galat; argumen tak dikenal juga ditolak.
 */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const args: SeedArgs = {};
  for (const arg of argv) {
    if (arg === '--remote' || arg === '-r' || arg === '--preview' || arg.startsWith('--remote=')) {
      throw new Error(
        'db:seed hanya untuk D1 LOKAL; --remote ditolak. Data contoh tidak boleh menyentuh D1 remote.',
      );
    }
    if (arg === '--local') continue;
    if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length).trim();
      continue;
    }
    throw new Error(`Argumen tidak dikenal: ${arg}`);
  }
  return args;
}

/** Argumen wrangler: SELALU `--local`, tidak pernah `--remote`. */
export function wranglerArgs(kind: 'migrate' | 'execute', file?: string): string[] {
  const base =
    kind === 'migrate'
      ? ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']
      : ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', file ?? ''];
  return [...base, '--config', 'wrangler.jsonc'];
}

export function resolveEmail(args: SeedArgs, env: Record<string, string | undefined>): string {
  const devVarsPath = join(WORKER_DIR, '.dev.vars');
  const fromFile = existsSync(devVarsPath)
    ? parseDevVars(readFileSync(devVarsPath, 'utf8')).DEV_LOGIN_EMAIL
    : undefined;
  const email = (args.email || env.DEV_LOGIN_EMAIL || fromFile || '').trim().toLowerCase();
  if (email === '') {
    throw new Error(
      'DEV_LOGIN_EMAIL belum diatur. Salin server/.dev.vars.example menjadi server/.dev.vars (atau jalankan bun run dev:worker sekali), atau beri --email=<email>.',
    );
  }
  return email;
}

function run(args: string[]): void {
  const proc = Bun.spawnSync(['bunx', ...args], {
    cwd: WORKER_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '2256d27ce4dcdcb9ade777cc2650fd81' },
  });
  if (proc.exitCode !== 0) throw new Error(`wrangler gagal (kode ${proc.exitCode})`);
}

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const email = resolveEmail(args, process.env);
  const sql = buildSeedSql(email, Date.now());
  mkdirSync(dirname(SQL_FILE), { recursive: true });
  writeFileSync(SQL_FILE, sql);
  console.log(`Menerapkan migrasi ke D1 LOKAL, lalu mengisi data contoh untuk ${email} ...`);
  run(wranglerArgs('migrate'));
  run(wranglerArgs('execute', SQL_FILE));
  console.log(
    'Selesai. Jalankan: bun run dev:worker, lalu buka http://localhost:8787/auth/dev-login',
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
