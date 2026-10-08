import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { findDuplicateGlobals, transformForGas } from './build-gas-lib';
import { GAS_DIR, GAS_DIST_DIR, ROOT_DIR, SHARED_DIR } from './paths';

interface SourceFile {
  absolute: string;
  output: string;
  enforcePrivateNames: boolean;
}

async function collect(
  dir: string,
  outPrefix: string,
  enforcePrivateNames: boolean,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for await (const relative of new Bun.Glob('**/*.ts').scan({ cwd: dir })) {
    const normalized = relative.replaceAll('\\', '/');
    if (normalized.includes('node_modules/')) continue;
    if (normalized.endsWith('.test.ts') || normalized.endsWith('.d.ts')) continue;
    files.push({
      absolute: path.join(dir, relative),
      output: path.join(GAS_DIST_DIR, outPrefix, normalized.replace(/\.ts$/, '.js')),
      enforcePrivateNames,
    });
  }
  return files.sort((a, b) => a.output.localeCompare(b.output));
}

const sources = [
  ...(await collect(path.join(GAS_DIR, 'src'), '', true)),
  ...(await collect(SHARED_DIR, 'shared', false)),
];

const results = [];
for (const source of sources) {
  const file = path.relative(ROOT_DIR, source.absolute).replaceAll('\\', '/');
  const text = await Bun.file(source.absolute).text();
  results.push({
    ...source,
    file,
    ...transformForGas(text, file, { enforcePrivateNames: source.enforcePrivateNames }),
  });
}

const duplicates = findDuplicateGlobals(results);
if (duplicates.length > 0) {
  console.error(`build:gas gagal — nama global bentrok:\n- ${duplicates.join('\n- ')}`);
  process.exit(1);
}

await rm(GAS_DIST_DIR, { recursive: true, force: true });
await mkdir(GAS_DIST_DIR, { recursive: true });
for (const result of results) await Bun.write(result.output, result.code);
await Bun.write(
  path.join(GAS_DIST_DIR, 'appsscript.json'),
  Bun.file(path.join(GAS_DIR, 'appsscript.json')),
);

console.log(
  `build:gas selesai — ${results.length} file → ${path.relative(ROOT_DIR, GAS_DIST_DIR)}`,
);
