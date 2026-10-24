import path from 'node:path';
import { BRIDGE_DIR, GAS_DIR } from './paths';

/**
 * Pagar bersama skrip clasp jembatan: tidak pernah menyentuh proyek atau deployment aplikasi lama (`gas/`).
 * Mengembalikan jalur berkas proyek clasp jembatan untuk lingkungan `env`.
 */
export async function bridgeProjectFile(env: string): Promise<string> {
  const project = path.join(BRIDGE_DIR, `.clasp.${env}.json`);
  if (!(await Bun.file(project).exists())) {
    throw new Error(
      `bridge/.clasp.${env}.json tidak ada. Salin bridge/.clasp.example.json dan isi scriptId (docs/setup-bridge.md).`,
    );
  }
  const { scriptId } = (await Bun.file(project).json()) as { scriptId?: string };
  const gasClasp = Bun.file(path.join(GAS_DIR, '.clasp.json'));
  const gasScriptId = (await gasClasp.exists())
    ? ((await gasClasp.json()) as { scriptId?: string }).scriptId
    : undefined;
  if (!scriptId || scriptId.startsWith('ISI_'))
    throw new Error(`scriptId di ${project} belum diisi`);
  if (gasScriptId && scriptId === gasScriptId) {
    throw new Error('scriptId jembatan sama dengan proyek aplikasi lama (gas/); dibatalkan');
  }
  return project;
}

/** Id deployment aplikasi lama yang TIDAK boleh disentuh. */
export async function legacyDeploymentId(): Promise<string | undefined> {
  const file = Bun.file(path.join(GAS_DIR, 'deployment.json'));
  return (await file.exists())
    ? ((await file.json()) as { deploymentId?: string }).deploymentId
    : undefined;
}
