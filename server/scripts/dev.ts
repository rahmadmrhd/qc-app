import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderDevVars } from './dev-vars';
import { wranglerArgs } from './seed-dev';

const WORKER_DIR = resolve(import.meta.dir, '..');

/** Menjalankan `wrangler dev` dengan D1 lokal: menyiapkan `.dev.vars`, direktori aset, dan migrasi. */
function main(): void {
  const devVars = join(WORKER_DIR, '.dev.vars');
  if (!existsSync(devVars)) {
    const example = readFileSync(join(WORKER_DIR, '.dev.vars.example'), 'utf8');
    writeFileSync(devVars, renderDevVars(example, crypto.randomUUID() + crypto.randomUUID()));
    console.log(
      'server/.dev.vars dibuat dari .dev.vars.example (ubah DEV_LOGIN_EMAIL bila perlu).',
    );
  }
  // wrangler menolak direktori aset yang tidak ada; build web mengisinya.
  mkdirSync(join(WORKER_DIR, 'dist'), { recursive: true });
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: '2256d27ce4dcdcb9ade777cc2650fd81' };
  const migrate = Bun.spawnSync(['bunx', ...wranglerArgs('migrate')], {
    cwd: WORKER_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
  });
  if (migrate.exitCode !== 0) process.exit(migrate.exitCode ?? 1);
  const dev = Bun.spawnSync(['bunx', 'wrangler', 'dev', '--local', '--config', 'wrangler.jsonc'], {
    cwd: WORKER_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
  });
  process.exit(dev.exitCode ?? 0);
}

main();
