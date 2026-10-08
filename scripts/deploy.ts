import path from 'node:path';
import { $ } from 'bun';
import { GAS_DIR } from './paths';

const config = (await Bun.file(path.join(GAS_DIR, 'deployment.json')).json()) as {
  deploymentId?: string;
};
if (!config.deploymentId) {
  console.error(
    'gas/deployment.json belum berisi deploymentId. Ikuti docs/setup-google.md langkah "Deployment pertama".',
  );
  process.exit(1);
}

const description = `deploy ${new Date().toISOString()}`;
await $`clasp deploy --deploymentId ${config.deploymentId} --description ${description}`.cwd(
  GAS_DIR,
);
console.log(
  `Deployment ${config.deploymentId} diperbarui. URL: https://script.google.com/macros/s/${config.deploymentId}/exec`,
);
