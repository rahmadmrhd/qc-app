import path from 'node:path';
import { $ } from 'bun';
import { bridgeProjectFile, legacyDeploymentId } from './bridge-clasp';
import { BRIDGE_DIR } from './paths';

// Deployment web app jembatan. Tanpa `bridge/deployment.<env>.json`: membuat deployment BARU (tanpa --deploymentId)
// dan mencatat id-nya. Dengan berkas itu: memperbarui deployment jembatan tersebut (URL tetap). Tidak pernah
// menyentuh deployment aplikasi lama.
const env = process.argv[2];
if (env !== 'staging' && env !== 'production') {
  console.error('Pemakaian: bun run scripts/deploy-bridge.ts <staging|production>');
  process.exit(1);
}
const project = await bridgeProjectFile(env);
const deploymentFile = path.join(BRIDGE_DIR, `deployment.${env}.json`);
const description = `deploy-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const legacy = await legacyDeploymentId();

if (await Bun.file(deploymentFile).exists()) {
  const config = (await Bun.file(deploymentFile).json()) as { deploymentId?: string };
  if (!config.deploymentId)
    throw new Error(`bridge/deployment.${env}.json belum berisi deploymentId`);
  if (config.deploymentId === legacy)
    throw new Error('deploymentId sama dengan aplikasi lama; dibatalkan');
  await $`bunx @google/clasp create-deployment --deploymentId ${config.deploymentId} --description ${description} --project ${project}`.cwd(
    BRIDGE_DIR,
  );
  console.log(`Deployment jembatan (${env}) diperbarui: ${config.deploymentId}`);
} else {
  const out =
    await $`bunx @google/clasp create-deployment --description ${description} --project ${project}`
      .cwd(BRIDGE_DIR)
      .text();
  const id = /Deployed\s+(\S+)/.exec(out)?.[1];
  if (!id) throw new Error(`Id deployment tidak terbaca dari keluaran clasp: ${out}`);
  if (id === legacy)
    throw new Error('clasp mengembalikan deployment aplikasi lama; periksa konfigurasi');
  await Bun.write(deploymentFile, `${JSON.stringify({ deploymentId: id }, null, 2)}\n`);
  console.log(`Deployment BARU jembatan (${env}): ${id}`);
  console.log(`URL: https://script.google.com/macros/s/${id}/exec`);
}
