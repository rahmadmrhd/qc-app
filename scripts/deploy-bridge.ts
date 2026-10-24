import path from 'node:path';
import { $ } from 'bun';
import { BRIDGE_DIR } from './paths';

// Memperbarui deployment web app jembatan yang SUDAH ada (URL tetap). Dijalankan MANUAL oleh pemilik.
const env = process.argv[2];
if (env !== 'staging' && env !== 'production') {
  console.error('Pemakaian: bun run scripts/deploy-bridge.ts <staging|production>');
  process.exit(1);
}
const project = path.join(BRIDGE_DIR, `.clasp.${env}.json`);
const deploymentFile = path.join(BRIDGE_DIR, `deployment.${env}.json`);
if (!(await Bun.file(project).exists()) || !(await Bun.file(deploymentFile).exists())) {
  console.error(
    `bridge/.clasp.${env}.json atau bridge/deployment.${env}.json tidak ada (docs/setup-bridge.md).`,
  );
  process.exit(1);
}
const config = (await Bun.file(deploymentFile).json()) as { deploymentId?: string };
if (!config.deploymentId) {
  console.error(`bridge/deployment.${env}.json belum berisi deploymentId.`);
  process.exit(1);
}
const description = `deploy-${new Date().toISOString()}`;
await $`clasp deploy --deploymentId ${config.deploymentId} --description ${description} --project ${project}`.cwd(
  BRIDGE_DIR,
);
console.log(`Deployment jembatan (${env}) diperbarui.`);
