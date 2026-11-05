import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './paths';

// `bun run dev`: server Bun (:8788, MariaDB dev lewat terowongan SSH) dan Vite (:3000, proxy /api /auth /sync ke
// server) bersamaan. Ctrl+C menghentikan keduanya. Pertama kali: salin server/.env.example menjadi server/.env,
// jalankan `bun run db:tunnel` di terminal lain, lalu `bun run db:seed`. Lihat docs/dev-server.md.

const ENV_FILE = path.join(ROOT_DIR, 'server', '.env');
const TUNNEL_TIMEOUT_MS = 2000;

/** Nilai satu kunci dari berkas .env sederhana (KEY=value per baris, komentar `#`, kutip opsional). */
export function readEnvValue(text: string, key: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0 || line.slice(0, index).trim() !== key) continue;
    const value = line.slice(index + 1).trim();
    return value.length >= 2 && /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return undefined;
}

/** host:port basis data bila `DATABASE_URL` menunjuk loopback (butuh terowongan); selain itu null. */
export function tunnelTarget(databaseUrl: string): { host: string; port: number } | null {
  try {
    const url = new URL(databaseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
    return loopback ? { host: url.hostname, port: Number(url.port || 3306) } : null;
  } catch {
    return null;
  }
}

async function canConnect(host: string, port: number): Promise<boolean> {
  try {
    const socket = await Promise.race([
      Bun.connect({ hostname: host, port, socket: { data() {}, error() {} } }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), TUNNEL_TIMEOUT_MS),
      ),
    ]);
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function preflight(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error(
      'server/.env belum ada. Salin server/.env.example menjadi server/.env dan isi DATABASE_URL (lihat docs/dev-server.md).',
    );
    process.exit(1);
  }
  const databaseUrl = readEnvValue(readFileSync(ENV_FILE, 'utf8'), 'DATABASE_URL') ?? '';
  const target = tunnelTarget(databaseUrl);
  if (target && !(await canConnect(target.host, target.port))) {
    console.error(
      `MariaDB dev tidak terjangkau di ${target.host}:${target.port}. Jalankan \`bun run db:tunnel\` di terminal lain (biarkan terbuka), lalu ulangi \`bun run dev\`.`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await preflight();
  const children = [
    Bun.spawn(['bun', 'run', 'dev:server'], { stdout: 'inherit', stderr: 'inherit' }),
    Bun.spawn(['bun', 'run', '--cwd', 'web', 'dev'], { stdout: 'inherit', stderr: 'inherit' }),
  ];

  const stop = () => {
    for (const child of children) child.kill();
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
  process.on('SIGTERM', stop);

  // Salah satu berhenti (galat atau ditutup) -> hentikan yang lain.
  await Promise.race(children.map((child) => child.exited));
  stop();
  process.exit(1);
}

if (import.meta.main) await main();
