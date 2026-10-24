import path from 'node:path';
import { $ } from 'bun';
import { BRIDGE_DIR } from './paths';

// Dijalankan MANUAL oleh pemilik (docs/setup-bridge.md); butuh clasp login dengan akun pemilik jembatan.
const env = process.argv[2];
if (env !== 'staging' && env !== 'production') {
  console.error('Pemakaian: bun run scripts/push-bridge.ts <staging|production>');
  process.exit(1);
}
const project = path.join(BRIDGE_DIR, `.clasp.${env}.json`);
if (!(await Bun.file(project).exists())) {
  console.error(
    `bridge/.clasp.${env}.json tidak ada. Salin bridge/.clasp.example.json dan isi scriptId (docs/setup-bridge.md).`,
  );
  process.exit(1);
}
await $`clasp push --force --project ${project}`.cwd(BRIDGE_DIR);
console.log(`clasp push jembatan (${env}) selesai`);
