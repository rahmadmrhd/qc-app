import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareContract, contractSnapshot, type SnapshotEntry } from '../shared/api-snapshot';
import { RETIRED_ROUTES } from '../shared/api-versions';

// `bun run api:snapshot`          menulis potret kontrak sekarang ke shared/api-contract.snapshot.json.
// `bun run api:snapshot --check`  membandingkan kontrak sekarang dengan berkas itu; pelanggaran = kode keluar 1.

const FILE = new URL('../shared/api-contract.snapshot.json', import.meta.url);

if (process.argv.includes('--check')) {
  const stored = JSON.parse(readFileSync(FILE, 'utf-8')) as SnapshotEntry[];
  const problems = compareContract(stored, contractSnapshot(), RETIRED_ROUTES);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`Kontrak sesuai potret (${stored.length} rute).`);
} else {
  const entries = contractSnapshot();
  writeFileSync(FILE, `${JSON.stringify(entries, null, 2)}\n`);
  // Biome memecah array pendek (mis. multipart.parts) per baris; format ulang agar `biome check` lolos.
  const formatted = Bun.spawnSync(
    [process.execPath, 'x', 'biome', 'format', '--write', fileURLToPath(FILE)],
    {
      stdout: 'ignore',
      stderr: 'pipe',
    },
  );
  if (formatted.exitCode !== 0) {
    console.error(`Biome gagal memformat potret: ${formatted.stderr.toString()}`);
    process.exit(1);
  }
  console.log(`Potret kontrak ditulis: ${entries.length} rute.`);
}
