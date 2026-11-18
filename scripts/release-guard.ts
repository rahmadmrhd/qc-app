// Guard rilis (pengganti uji ulang; workflow .github/workflows/release.yml, job `guard`; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.4). Kode yang dirilis harus identik dengan yang sudah
// berjalan di staging: commit rilis harus MENDAHULUI `refs/deployed/staging` (status `ahead`, atau `identical`) dan semua
// berkas yang berubah sejak itu hanya metadata rilis server (versi, bun.lock, CHANGELOG, fragmen), dan CHANGELOG sudah
// memuat bagian versinya. Murni: perbandingan dilakukan pemanggil lewat `gh api compare`.
import { isMetadataOnly } from './changelog-check';

export interface GuardInput {
  /** `status` dari `repos/R/compare/<refs/deployed/staging>...<sha>`: ahead | identical | behind | diverged. */
  compareStatus: string;
  /** Berkas yang berubah menurut perbandingan itu. */
  files: string[];
  /** `server/CHANGELOG.md` memuat bagian `## [versi]`. */
  changelogHasVersion: boolean;
}

const RECOVERY =
  'Pulihkan: biarkan dev stabil, ulangi deploy staging, lalu jalankan ulang release.yml lewat workflow_dispatch (input versi).';

export function evaluateGuard(input: GuardInput): { ok: boolean; reason: string } {
  if (input.compareStatus !== 'ahead' && input.compareStatus !== 'identical') {
    return {
      ok: false,
      reason: `Commit rilis bukan turunan dari yang terakhir berjalan di staging (status: ${input.compareStatus === '' ? 'tidak diketahui' : 'tidak sejalan'}). ${RECOVERY}`,
    };
  }
  if (!isMetadataOnly(input.files, 'server')) {
    return {
      ok: false,
      reason: `Ada perubahan selain metadata rilis yang belum berjalan di staging (kode belum teruji di sana). ${RECOVERY}`,
    };
  }
  if (!input.changelogHasVersion) {
    return { ok: false, reason: 'server/CHANGELOG.md belum memuat bagian untuk versi rilis ini.' };
  }
  return { ok: true, reason: 'Kode identik dengan staging; hanya metadata rilis yang berbeda.' };
}

if (import.meta.main) {
  const env = process.env;
  const result = evaluateGuard({
    compareStatus: env.COMPARE_STATUS ?? '',
    files: (env.FILES ?? '').split('\n').filter((line) => line.trim() !== ''),
    changelogHasVersion: env.CHANGELOG_HAS_VERSION === 'true',
  });
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(result.reason);
}
