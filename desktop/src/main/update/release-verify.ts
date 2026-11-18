// Menilai manifest rilis dari server (spek desktop 5.5): tanda tangan Ed25519 dengan kunci publik tertanam, bentuk
// kanonik dan schema, versi LEBIH BARU daripada yang terpasang (pembaruan hanya naik), dan berkas untuk arsitektur ini.
// Murni (tanpa jaringan/Electron). Alasan penolakan hanya untuk log: generik, tanpa isi manifest dan tanpa identitas repo.
import { verifyUiManifest } from '@countrylock/ui-manifest';
import {
  compareVersions,
  type DesktopReleaseManifest,
  parseReleaseManifest,
  type ReleaseArch,
  type ReleaseFile,
} from '@shared/desktop-release';

export interface EvaluateInput {
  /** Teks manifest persis yang ditandatangani (`JSON.stringify` dari objek `manifest` jawaban server). */
  manifestJson: string;
  signature: string;
  publicKeyPem: string;
  installedVersion: string;
  arch: ReleaseArch;
}

export type Evaluation =
  | { kind: 'available'; manifest: DesktopReleaseManifest; file: ReleaseFile }
  | { kind: 'none'; reason: string };

export function evaluateRelease(input: EvaluateInput): Evaluation {
  const none = (reason: string): Evaluation => ({ kind: 'none', reason });
  // Tanda tangan diperiksa PERTAMA dan atas teks mentah: tak ada yang diurai dari data tak tepercaya sebelum lolos.
  if (!verifyUiManifest(input.manifestJson, input.signature, input.publicKeyPem)) {
    return none('tanda tangan rilis tidak sah');
  }
  const manifest = parseReleaseManifest(input.manifestJson);
  if (!manifest) return none('manifest rilis tidak dikenal');
  if (compareVersions(manifest.version, input.installedVersion) <= 0) {
    return none('tidak ada versi yang lebih baru');
  }
  const file = manifest.files.find((entry) => entry.arch === input.arch);
  if (!file) return none('rilis tidak memuat berkas untuk arsitektur ini');
  return { kind: 'available', manifest, file };
}
