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
  /**
   * Jumlah berkas menurut API compare. API memotong daftar `files` pada 300 TANPA penanda, jadi jumlah >= 300 berarti daftar
   * tak lengkap dan tak dapat dipercaya (gagal tertutup). Tak diberikan = panjang `files`; bukan angka = ditolak.
   */
  fileCount?: number;
  /** `server/CHANGELOG.md` memuat bagian `## [versi]`. */
  changelogHasVersion: boolean;
}

/** Batas API compare GitHub: daftar `files` maksimum 300 untuk seluruh perbandingan, sisanya terpotong diam-diam. */
const COMPARE_FILE_LIMIT = 300;

const RECOVERY =
  'Pulihkan: biarkan dev stabil, ulangi deploy staging, lalu jalankan ulang release.yml lewat workflow_dispatch (input versi).';

export function evaluateGuard(input: GuardInput): { ok: boolean; reason: string } {
  if (input.compareStatus !== 'ahead' && input.compareStatus !== 'identical') {
    return {
      ok: false,
      reason: `Commit rilis bukan turunan dari yang terakhir berjalan di staging (status: ${input.compareStatus === '' ? 'tidak diketahui' : 'tidak sejalan'}). ${RECOVERY}`,
    };
  }
  const count = input.fileCount ?? input.files.length;
  if (!Number.isFinite(count) || count >= COMPARE_FILE_LIMIT) {
    return {
      ok: false,
      reason: `Daftar berkas perbandingan dengan staging terpotong atau tak terbaca (${COMPARE_FILE_LIMIT} berkas atau lebih): tak dapat dipastikan hanya metadata yang berbeda. ${RECOVERY}`,
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
  // Daftar berkas datang sebagai SATU baris JSON (`jq -c`), bukan teks per baris: nama berkas git boleh memuat baris baru dan
  // tak boleh dapat menyelipkan baris `GITHUB_OUTPUT` palsu. JSON rusak = daftar kosong tak dipercaya = jumlah NaN (ditolak).
  let files: string[] = [];
  let fileCount = Number(env.FILE_COUNT ?? '');
  try {
    const parsed: unknown = JSON.parse(env.FILES_JSON ?? '[]');
    if (Array.isArray(parsed))
      files = parsed.filter((item): item is string => typeof item === 'string');
    else fileCount = Number.NaN;
  } catch {
    fileCount = Number.NaN;
  }
  const result = evaluateGuard({
    compareStatus: env.COMPARE_STATUS ?? '',
    files,
    fileCount,
    changelogHasVersion: env.CHANGELOG_HAS_VERSION === 'true',
  });
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(result.reason);
}
