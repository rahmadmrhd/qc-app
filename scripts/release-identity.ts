// Pagar identitas PR rilis (workflow .github/workflows/release.yml, job `meta`; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.4 dan docs/superpowers/specs/2026-11-19-rilis-gabungan-design.md).
// Memutuskan apakah PR yang di-merge ke `main` SAH sebagai PR rilis, dan komponen mana (server, desktop, atau keduanya) yang
// dirilisnya. Murni (tanpa GitHub): semua nilai masuk lewat parameter agar dapat diuji.
//
// Bentuk cabang yang sah (versi persis semver X.Y.Z tanpa awalan nol):
//   release/server-vX.Y.Z                          -> server
//   release/desktop-vX.Y.Z                         -> desktop
//   release/gabungan-server-vX.Y.Z-desktop-vA.B.C  -> keduanya (satu PR, satu commit rilis)
// Untuk SETIAP komponen yang disebut cabang, `version` di `<komponen>/package.json` pada commit merge harus sama dengan
// versi cabang (versi komponen yang tak disebut cabang tak diperiksa).
//
// Alasan penolakan sengaja generik: nilai masukan mentah (nama cabang, repositori, isi berkas) dapat dikendalikan penulis PR
// dan tidak boleh ikut tercetak ke log. Hanya versi yang lolos validasi `isSemver` yang boleh disebut.
import { appendFileSync } from 'node:fs';
import { type Component, isSemver } from './changelog';

export type ReleaseVersions = Partial<Record<Component, string>>;

const SERVER_REF = /^release\/server-v(\d+\.\d+\.\d+)$/;
const DESKTOP_REF = /^release\/desktop-v(\d+\.\d+\.\d+)$/;
const BOTH_REF = /^release\/gabungan-server-v(\d+\.\d+\.\d+)-desktop-v(\d+\.\d+\.\d+)$/;

/** Komponen dan versi yang disebut nama cabang rilis, atau `null` bila bukan salah satu dari tiga bentuk yang sah. */
export function parseReleaseRef(headRef: string): ReleaseVersions | null {
  const both = BOTH_REF.exec(headRef);
  if (both) {
    const [, server, desktop] = both as unknown as [string, string, string];
    return isSemver(server) && isSemver(desktop) ? { server, desktop } : null;
  }
  const server = SERVER_REF.exec(headRef)?.[1];
  if (server !== undefined) return isSemver(server) ? { server } : null;
  const desktop = DESKTOP_REF.exec(headRef)?.[1];
  if (desktop !== undefined) return isSemver(desktop) ? { desktop } : null;
  return null;
}

/**
 * Komponen yang dimuat PR rilis menurut nama cabangnya (`server`, `desktop`, `server,desktop`; kosong bila bukan cabang rilis
 * yang sah), TIDAK terpengaruh `only`: job `guard` memakainya untuk tahu metadata komponen mana yang sah berbeda dari staging
 * walau run pemulihan hanya merilis satu komponen dari PR gabungan.
 */
export function releaseComponents(headRef: string): string {
  const versions = parseReleaseRef(headRef);
  if (versions === null) return '';
  return (['server', 'desktop'] as const).filter((c) => versions[c] !== undefined).join(',');
}

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
  versionsAtMerge: ReleaseVersions;
  /** Pemulihan lewat dispatch: hanya komponen ini yang dirilis ulang (harus termasuk dalam cabang). */
  only?: Component | undefined;
  /** Nilai variabel repositori `RELEASE_FLOW`; cabang gabungan (menyertakan server) hanya sah bila `tag`. */
  releaseFlow?: string | undefined;
}

/**
 * Nilai `only` dari env: kosong = tanpa pembatasan; hanya `server` atau `desktop` yang sah. Nilai lain GAGAL (bukan dianggap
 * kosong) agar nilai tak dikenal tak diam-diam merilis semua komponen cabang.
 */
export function parseOnly(
  value: string | undefined,
): { ok: true; only: Component | undefined } | { ok: false } {
  if (value === undefined || value === '') return { ok: true, only: undefined };
  if (value === 'server' || value === 'desktop') return { ok: true, only: value };
  return { ok: false };
}

export type IdentityResult =
  | { ok: true; versions: ReleaseVersions }
  | { ok: false; reason: string };

export function checkIdentity(input: IdentityInput): IdentityResult {
  const fail = (reason: string): IdentityResult => ({ ok: false, reason });
  if (input.baseRef !== 'main') return fail('PR rilis harus bertujuan ke main.');
  if (input.baseRepo === '' || input.headRepo !== input.baseRepo) {
    return fail('PR rilis harus berasal dari repositori ini (bukan fork).');
  }
  const branch = parseReleaseRef(input.headRef);
  if (branch === null) {
    return fail(
      'Nama cabang bukan release/server-vX.Y.Z, release/desktop-vX.Y.Z, atau release/gabungan-server-vX.Y.Z-desktop-vA.B.C yang sah (versi tanpa awalan nol atau akhiran).',
    );
  }
  if (branch.server !== undefined && branch.desktop !== undefined && input.releaseFlow !== 'tag') {
    return fail(
      'Rilis gabungan hanya sah saat variabel RELEASE_FLOW bernilai tag (komponen server memerlukannya).',
    );
  }
  if (input.parents !== 2) {
    return fail('PR rilis harus di-merge dengan merge commit (bukan squash atau rebase).');
  }
  for (const component of ['server', 'desktop'] as const) {
    const version = branch[component];
    if (version !== undefined && input.versionsAtMerge[component] !== version) {
      return fail(
        `Versi di ${component}/package.json pada commit merge tidak sama dengan versi cabang (${version}).`,
      );
    }
  }
  if (input.only !== undefined) {
    const version = branch[input.only];
    if (version === undefined) {
      return fail(`Cabang rilis itu tidak merilis komponen ${input.only}.`);
    }
    return { ok: true, versions: { [input.only]: version } };
  }
  return { ok: true, versions: branch };
}

export interface ReleaseOutputs {
  /** Ada komponen yang dirilis run ini. */
  release: boolean;
  /** Versi server yang dirilis, atau kosong. */
  server: string;
  /** Versi desktop yang dirilis, atau kosong. */
  desktop: string;
}

/**
 * Keluaran untuk job lain. Saklar mode rilis (keputusan pemilik 2026-11-18): server hanya dirilis bila `RELEASE_FLOW` bernilai
 * `tag`; selain itu `deploy-server.yml` yang men-deploy production dan server dilewati di sini. Desktop tak bergantung pada saklar
 * (rilis desktop tak men-deploy production).
 */
export function releaseOutputs(
  versions: ReleaseVersions,
  releaseFlow: string | undefined,
): ReleaseOutputs {
  const server = releaseFlow === 'tag' ? (versions.server ?? '') : '';
  const desktop = versions.desktop ?? '';
  return { release: server !== '' || desktop !== '', server, desktop };
}

if (import.meta.main) {
  const env = process.env;
  const parsedOnly = parseOnly(env.ONLY);
  if (!parsedOnly.ok) {
    console.log('::error::Komponen pemulihan tidak dikenal (harus server atau desktop).');
    process.exit(1);
  }
  const only = parsedOnly.only;
  const result = checkIdentity({
    baseRepo: env.BASE_REPO ?? '',
    headRepo: env.HEAD_REPO ?? '',
    headRef: env.HEAD_REF ?? '',
    baseRef: env.BASE_REF ?? '',
    parents: Number(env.PARENTS ?? ''),
    versionsAtMerge: {
      server: env.SERVER_VERSION_AT_MERGE ?? '',
      desktop: env.DESKTOP_VERSION_AT_MERGE ?? '',
    },
    only,
    releaseFlow: env.RELEASE_FLOW,
  });
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  const outputs = releaseOutputs(result.versions, env.RELEASE_FLOW);
  const labels = [
    result.versions.server !== undefined ? `server v${result.versions.server}` : '',
    result.versions.desktop !== undefined ? `desktop v${result.versions.desktop}` : '',
  ].filter((label) => label !== '');
  console.log(`PR rilis (${labels.join(' + ')}) lolos pagar identitas.`);
  if (result.versions.server !== undefined && outputs.server === '') {
    console.log(
      '::notice::RELEASE_FLOW bukan "tag": komponen server dilewati (deploy-server.yml yang men-deploy production).',
    );
  }
  if (env.GITHUB_OUTPUT) {
    // Nilai sudah lolos isSemver (atau kosong): aman ditulis sebagai satu baris keluaran.
    appendFileSync(
      env.GITHUB_OUTPUT,
      `release=${outputs.release}\nserver_version=${outputs.server}\ndesktop_version=${outputs.desktop}\ncomponents=${releaseComponents(env.HEAD_REF ?? '')}\n`,
    );
  }
}
