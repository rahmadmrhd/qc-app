// Pagar identitas PR rilis (workflow .github/workflows/release.yml, job `meta`; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.4). Memutuskan apakah PR yang di-merge ke `main` SAH
// sebagai PR rilis server. Murni (tanpa GitHub): semua nilai masuk lewat parameter agar dapat diuji.
//
// Alasan penolakan sengaja generik: nilai masukan mentah (nama cabang, repositori) dapat dikendalikan penulis PR dan tidak
// boleh ikut tercetak ke log. Hanya versi yang lolos validasi `isSemver` yang boleh disebut.
import { appendFileSync } from 'node:fs';
import { type Component, isSemver } from './changelog';

export interface IdentityInput {
  /** `github.repository` (pemilik/nama). */
  baseRepo: string;
  /** Repositori asal cabang PR (`pull_request.head.repo.full_name`). */
  headRepo: string;
  /** Nama cabang PR (`pull_request.head.ref`). */
  headRef: string;
  /** Cabang tujuan PR (`pull_request.base.ref`). */
  baseRef: string;
  /** Jumlah induk commit merge (merge commit = 2; squash/rebase = 1). */
  parents: number;
  /** `version` di `<komponen>/package.json` pada commit merge. */
  versionAtMerge: string;
  /** Komponen yang dirilis; tanpa nilai = `server` (rilis server dulu satu-satunya). */
  component?: Component | undefined;
}

export type IdentityResult =
  | { ok: true; component: Component; version: string }
  | { ok: false; reason: string };

export function checkIdentity(input: IdentityInput): IdentityResult {
  const fail = (reason: string): IdentityResult => ({ ok: false, reason });
  if (input.baseRef !== 'main') return fail('PR rilis harus bertujuan ke main.');
  if (input.baseRepo === '' || input.headRepo !== input.baseRepo) {
    return fail('PR rilis harus berasal dari repositori ini (bukan fork).');
  }
  const component = input.component ?? 'server';
  const prefix = `release/${component}-v`;
  const version = input.headRef.startsWith(prefix) ? input.headRef.slice(prefix.length) : '';
  if (!isSemver(version)) {
    return fail(
      `Nama cabang bukan release/${component}-vX.Y.Z yang sah (X.Y.Z tanpa awalan nol atau akhiran).`,
    );
  }
  if (input.parents !== 2) {
    return fail('PR rilis harus di-merge dengan merge commit (bukan squash atau rebase).');
  }
  if (input.versionAtMerge !== version) {
    return fail(
      `Versi di ${component}/package.json pada commit merge tidak sama dengan versi cabang (${version}).`,
    );
  }
  return { ok: true, component, version };
}

if (import.meta.main) {
  const env = process.env;
  const result = checkIdentity({
    baseRepo: env.BASE_REPO ?? '',
    headRepo: env.HEAD_REPO ?? '',
    headRef: env.HEAD_REF ?? '',
    baseRef: env.BASE_REF ?? '',
    parents: Number(env.PARENTS ?? ''),
    versionAtMerge: env.VERSION_AT_MERGE ?? '',
    component: env.COMPONENT === 'desktop' ? 'desktop' : 'server',
  });
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(`PR rilis ${result.component} v${result.version} lolos pagar identitas.`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `version=${result.version}\n`);
}
