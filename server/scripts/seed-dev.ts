import { createDb, toDbError } from '@server/core/db';
import { applyMigrations } from '@server/core/migrate';
import { applySeed } from './seed-data';

/** Satu-satunya skema yang boleh diisi data contoh (dev di VPS; tidak pernah staging/produksi). */
export const SEED_DATABASE = 'qc_dev';

export interface SeedArgs {
  email?: string;
}

/** Argumen skrip: hanya `--email=<email>`; argumen lain (termasuk yang menunjuk database lain) ditolak. */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const args: SeedArgs = {};
  for (const arg of argv) {
    if (arg.startsWith('--email=')) {
      args.email = arg.slice('--email='.length).trim();
      continue;
    }
    throw new Error(`Argumen tidak dikenal: ${arg}`);
  }
  return args;
}

/** Nama database pada `DATABASE_URL` (kosong bila tidak ada). */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Menolak URL yang tidak menunjuk skema `qc_dev`: seed MENGHAPUS data tabel sebelum mengisi. */
export function assertSeedTarget(url: string | undefined): string {
  if (!url?.trim()) {
    throw new Error(
      'DATABASE_URL belum diatur. Salin server/.env.example menjadi server/.env dan isi DATABASE_URL.',
    );
  }
  const name = databaseNameOf(url.trim());
  if (name !== SEED_DATABASE) {
    throw new Error(
      `db:seed hanya untuk skema ${SEED_DATABASE} (DATABASE_URL menunjuk skema "${name}"). Data contoh tidak boleh menyentuh database lain.`,
    );
  }
  return url.trim();
}

export function resolveEmail(args: SeedArgs, env: Record<string, string | undefined>): string {
  const email = (args.email || env.DEV_LOGIN_EMAIL || '').trim().toLowerCase();
  if (email === '') {
    throw new Error(
      'DEV_LOGIN_EMAIL belum diatur. Isi di server/.env (dari .env.example), atau beri --email=<email>.',
    );
  }
  return email;
}

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const url = assertSeedTarget(process.env.DATABASE_URL);
  const email = resolveEmail(args, process.env);
  const db = createDb({ url, connectionLimit: 2 });
  try {
    console.log(
      `Menerapkan migrasi ke ${SEED_DATABASE}, lalu mengisi data contoh untuk ${email} ...`,
    );
    const applied = await applyMigrations(db);
    if (applied.length > 0) console.log(`Migrasi baru: ${applied.join(', ')}`);
    await applySeed(db, email, Date.now());
  } catch (error) {
    throw new Error(toDbError(error).message);
  } finally {
    await db.close();
  }
  console.log(
    'Selesai. Jalankan: bun run dev, lalu buka http://localhost:3000/auth/dev-login (login pengguna dev).',
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
