// Guard rilis (pengganti uji ulang; workflow .github/workflows/release.yml, job `guard`; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.4). Kode yang dirilis harus identik dengan yang sudah
// berjalan di staging: commit rilis harus MENDAHULUI `refs/deployed/staging` (status `ahead`, atau `identical`) dan setiap
// berkas yang berubah sejak itu adalah metadata rilis (versi, bun.lock, CHANGELOG, fragmen) ATAU berkas yang tak masuk image
// server (dokumentasi, kode desktop; klasifikasi `image` di `ci-changes.ts`, satu-satunya definisi "men-deploy staging"), dan
// CHANGELOG sudah memuat bagian versinya. Berkas jenis kedua tak pernah men-deploy staging (PR-nya tak memajukan
// `refs/deployed/staging`), jadi menolaknya menggagalkan rilis tanpa alasan (keputusan pemilik 2026-11-19). Murni: perbandingan
// dilakukan pemanggil lewat `gh api compare`.
import type { Component } from './changelog';
import { isMetadataOnlyOf } from './changelog-check';
import { classify } from './ci-changes';

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
  /** `CHANGELOG.md` setiap komponen yang dirilis memuat bagian `## [versi]`-nya (dihitung pemanggil). */
  changelogHasVersion: boolean;
  /**
   * Komponen yang dirilis commit ini; berkas metadata komponen-komponen ini sah berbeda dari staging. Bawaan `['server']`
   * (rilis server saja: metadata desktop tetap ditolak). Rilis gabungan memberi `['server', 'desktop']`.
   */
  components?: Component[];
}

/**
 * Berkas yang mengubah isi image server (jalur tak dikenal dianggap mengubahnya: `classify` gagal tertutup). Jalur berspasi atau
 * berkarakter kontrol di ujung juga dianggap mengubahnya: `classify` memangkasnya, sedangkan Docker tidak (`a.md ` tetap di-COPY).
 * Berkas `.github/workflows/` juga tetap dianggap mengubahnya di guard ini (gagal tertutup, keputusan 2026-11-19), walau
 * `classify` kini hanya menyalakan `code` untuknya (keputusan CI 2026-11-20): melonggarkan guard rilis adalah keputusan
 * terpisah yang belum diambil pemilik.
 */
const touchesImage = (path: string): boolean =>
  path !== path.trim() || path.startsWith('.github/workflows/') || classify([path]).image;

/**
 * Berkas selisih yang BELUM berjalan di staging dan tak boleh ikut rilis server: bukan metadata rilis `components` dan masuk
 * image server. Dipakai guard CI (`evaluateGuard`) dan `release:prepare` agar keduanya satu definisi.
 */
export function unverifiedFiles(files: string[], components: Component[] = ['server']): string[] {
  return files.filter((path) => !isMetadataOnlyOf([path], components) && touchesImage(path));
}

/** Batas API compare GitHub: daftar `files` maksimum 300 untuk seluruh perbandingan, sisanya terpotong diam-diam. */
const COMPARE_FILE_LIMIT = 300;

const RECOVERY =
  'Pulihkan: biarkan dev stabil, ulangi deploy staging, lalu jalankan ulang release.yml lewat workflow_dispatch (input komponen dan versi).';

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
  const unverified = unverifiedFiles(input.files, input.components);
  if (unverified.length > 0) {
    const shown = unverified.slice(0, 5).map((path) => JSON.stringify(path));
    const more =
      unverified.length > shown.length ? ` +${unverified.length - shown.length} lagi` : '';
    return {
      ok: false,
      reason: `Ada perubahan yang masuk image server dan belum berjalan di staging (kode belum teruji di sana): ${shown.join(', ')}${more}. ${RECOVERY}`,
    };
  }
  if (!input.changelogHasVersion) {
    return {
      ok: false,
      reason:
        'CHANGELOG.md belum memuat bagian untuk versi rilis ini (server, dan desktop bila ikut dirilis).',
    };
  }
  return {
    ok: true,
    reason:
      'Isi image server identik dengan staging; yang berbeda hanya metadata rilis dan berkas di luar image (dokumentasi, kode desktop).',
  };
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
  // Gagal tertutup: hanya nilai persis `server,desktop` yang menambah komponen desktop; selain itu server saja.
  const components: Component[] =
    env.COMPONENTS === 'server,desktop' ? ['server', 'desktop'] : ['server'];
  const result = evaluateGuard({
    components,
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
