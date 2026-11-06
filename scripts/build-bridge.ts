import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildBridgeFiles, loadBridgeFiles, missingBridgeEntryPoints } from './build-bridge-lib';
import { BRIDGE_DIR, BRIDGE_DIST_DIR, ROOT_DIR } from './paths';

const files = await buildBridgeFiles();
const problems = [
  ...loadBridgeFiles(files),
  ...missingBridgeEntryPoints(files).map((name) => `fungsi ${name} tidak ada setelah build`),
];
const manifest = JSON.parse(await Bun.file(path.join(BRIDGE_DIR, 'appsscript.json')).text()) as {
  webapp?: { access?: string; executeAs?: string };
};
if (
  manifest.webapp?.executeAs !== 'USER_DEPLOYING' ||
  manifest.webapp?.access !== 'ANYONE_ANONYMOUS'
) {
  problems.push('bridge/appsscript.json: web app harus USER_DEPLOYING + ANYONE_ANONYMOUS');
}
if (problems.length > 0) {
  console.error(`build:bridge gagal:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

await rm(BRIDGE_DIST_DIR, { recursive: true, force: true });
await mkdir(BRIDGE_DIST_DIR, { recursive: true });
for (const file of files) await Bun.write(path.join(BRIDGE_DIST_DIR, file.output), file.code);
await Bun.write(
  path.join(BRIDGE_DIST_DIR, 'appsscript.json'),
  Bun.file(path.join(BRIDGE_DIR, 'appsscript.json')),
);
console.log(
  `build:bridge selesai — ${files.length} file → ${path.relative(ROOT_DIR, BRIDGE_DIST_DIR)}`,
);
