import type { DesktopReleaseDto } from '@shared/contract';
import { compareVersions, RELEASE_ARCHS } from '@shared/desktop-release';
import { base64ToBytes } from '../../core/bytes';
import type { ServedRelease } from './app-release';

/** Awalan rute publik unduhan installer (`desktopApp.get('/app-file/*')`). */
const APP_FILE_PATH = '/api/desktop/app-file';

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Manifest rilis -> DTO daftar unduhan. `sha512` manifest berbentuk base64 (konvensi `electron-updater`), sedangkan
 * `Get-FileHash -Algorithm SHA512` mengeluarkan heksadesimal: dikonversi di sini agar pengguna dapat membandingkan
 * langsung. Berkas diurut x64 lalu arm64.
 */
export function toReleaseDto(release: ServedRelease): DesktopReleaseDto {
  const { manifest } = release;
  const files = [...manifest.files]
    .sort((a, b) => RELEASE_ARCHS.indexOf(a.arch) - RELEASE_ARCHS.indexOf(b.arch))
    .map((file) => ({
      arch: file.arch,
      name: file.name,
      size: file.size,
      sha512: hexOf(base64ToBytes(file.sha512)),
      url: `${APP_FILE_PATH}/${encodeURIComponent(manifest.version)}/${encodeURIComponent(file.name)}`,
    }));
  return {
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    changelog: manifest.changelog,
    files,
  };
}

/** Hanya versi >= `minDesktop` (perbandingan semver numerik); urutan masukan dipertahankan. */
export function filterSupported(releases: ServedRelease[], minDesktop: string): ServedRelease[] {
  return releases.filter((release) => compareVersions(release.version, minDesktop) >= 0);
}
