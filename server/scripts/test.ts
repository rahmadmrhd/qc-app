// Menjalankan `bun test --preload test-support/global-setup.ts` hanya pada tes yang sudah dipindah ke MariaDB
// (test-support/ported-modules.ts). Argumen tambahan diteruskan ke `bun test` (mis. `-t "<nama>"`, `--bail`).
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Glob } from 'bun';
import { EXCLUDED, PORTED } from '../test-support/ported-modules';

const root = resolve(import.meta.dir, '..');
const files = new Set<string>();
for (const entry of PORTED) {
  const full = resolve(root, entry);
  if (statSync(full).isDirectory()) {
    for (const file of new Glob('**/*.test.ts').scanSync({ cwd: full })) {
      files.add(`${entry}/${file.replaceAll('\\', '/')}`);
    }
  } else {
    files.add(entry);
  }
}
for (const excluded of Object.keys(EXCLUDED)) files.delete(excluded);

const proc = Bun.spawn(
  [
    process.execPath,
    'test',
    '--preload',
    './test-support/global-setup.ts',
    '--timeout',
    '30000',
    ...[...files].sort().map((file) => `./${file}`),
    ...process.argv.slice(2),
  ],
  { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
);
process.exit(await proc.exited);
