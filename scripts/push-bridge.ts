import { $ } from 'bun';
import { bridgeProjectFile } from './bridge-clasp';
import { BRIDGE_DIR } from './paths';

// Dijalankan MANUAL (docs/setup-bridge.md); butuh `clasp login` dengan akun pemilik jembatan. Jalankan
// `bun run build:bridge` dulu. Hanya proyek jembatan (cwd bridge/, --project eksplisit); tidak menyentuh gas/.
const env = process.argv[2];
if (env !== 'staging' && env !== 'production') {
  console.error('Pemakaian: bun run scripts/push-bridge.ts <staging|production>');
  process.exit(1);
}
const project = await bridgeProjectFile(env);
await $`bunx @google/clasp push --force --project ${project}`.cwd(BRIDGE_DIR);
console.log(`clasp push jembatan (${env}) selesai`);
