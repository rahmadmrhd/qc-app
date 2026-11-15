import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  normalizeFingerprint,
  publicKeyFingerprint,
  publicKeyPemOf,
  signUiManifest,
  UI_MANIFEST_FILE,
  UI_MANIFEST_SIGNATURE_FILE,
  verifyUiManifest,
} from '../countrylock/src/ui-manifest';
import { WEB_DIST_DIR } from './paths';

/**
 * Menandatangani `ui-manifest.json` di `distDir` dengan kunci privat Ed25519 (PEM PKCS8) dari BERKAS `keyFile`
 * dan menulis `ui-manifest.sig` (base64url). Kunci tak pernah masuk pesan galat atau log. Mengembalikan tanda tangan.
 * `expectedFingerprint` (SHA-256 SPKI kunci publik yang tertanam di desktop): bila diberikan dan tak sama dengan
 * sidik kunci publik hasil kunci privat, penandatanganan GAGAL sebelum `.sig` ditulis (desktop akan menolak semua
 * pembaruan UI). Padanan manual/CI: `scripts/check-ui-key.ts`.
 */
export function signDistManifest(
  distDir: string,
  keyFile: string,
  expectedFingerprint?: string,
): string {
  const manifestPath = path.join(distDir, UI_MANIFEST_FILE);
  let json: string;
  try {
    json = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`${UI_MANIFEST_FILE} tidak ada di ${distDir}; jalankan build-ui-manifest dulu`);
  }
  let privateKeyPem: string;
  try {
    privateKeyPem = readFileSync(keyFile, 'utf8');
  } catch {
    throw new Error(`Berkas kunci penandatangan tidak terbaca: ${keyFile}`);
  }
  let signature: string;
  try {
    signature = signUiManifest(json, privateKeyPem);
    // Pastikan pasangan kunci konsisten sebelum menulis apa pun.
    if (!verifyUiManifest(json, signature, publicKeyPemOf(privateKeyPem))) throw new Error('x');
  } catch {
    // Pesan sengaja generik: isi kunci tak boleh ikut ke galat.
    throw new Error('Kunci penandatangan tidak sah (butuh PEM PKCS8 Ed25519)');
  }
  if (expectedFingerprint?.trim()) {
    const expected = normalizeFingerprint(expectedFingerprint);
    if (!expected) throw new Error('UI_PUBLIC_KEY_FINGERPRINT bukan SHA-256 heksa 64 karakter');
    if (publicKeyFingerprint(publicKeyPemOf(privateKeyPem)) !== expected) {
      throw new Error(
        'Kunci penandatangan TIDAK berpasangan dengan kunci publik desktop (sidik tidak sama dengan UI_PUBLIC_KEY_FINGERPRINT)',
      );
    }
  }
  writeFileSync(path.join(distDir, UI_MANIFEST_SIGNATURE_FILE), signature, 'utf8');
  return signature;
}

if (import.meta.main) {
  // Jalur berkas kunci lewat `--key <jalur>` atau env UI_SIGNING_KEY_FILE (bukan isi kunci); tidak pernah dicetak.
  const flag = process.argv.indexOf('--key');
  const keyFile =
    (flag >= 0 ? process.argv[flag + 1] : undefined) ?? process.env.UI_SIGNING_KEY_FILE;
  const distFlag = process.argv.indexOf('--dist');
  const distDir = (distFlag >= 0 ? process.argv[distFlag + 1] : undefined) ?? WEB_DIST_DIR;
  if (!keyFile) {
    console.error('sign-ui-manifest: berikan --key <berkas PEM> atau env UI_SIGNING_KEY_FILE');
    process.exit(1);
  }
  try {
    if (!statSync(keyFile).isFile()) throw new Error('bukan berkas');
    const flagFingerprint = process.argv.indexOf('--expect-fingerprint');
    const expectedFingerprint =
      (flagFingerprint >= 0 ? process.argv[flagFingerprint + 1] : undefined) ??
      process.env.UI_PUBLIC_KEY_FINGERPRINT;
    signDistManifest(distDir, keyFile, expectedFingerprint);
    console.log('sign-ui-manifest OK (ui-manifest.sig ditulis)');
    // Sidik kunci publik (bukan rahasia) dicetak agar dapat dibandingkan dengan kunci yang tertanam di desktop.
    console.log(
      `  sidik kunci publik penandatangan: ${publicKeyFingerprint(publicKeyPemOf(readFileSync(keyFile, 'utf8')))}`,
    );
    if (!expectedFingerprint?.trim()) {
      console.warn(
        'sign-ui-manifest peringatan: UI_PUBLIC_KEY_FINGERPRINT tidak diberikan; kecocokan dengan kunci publik desktop TIDAK diperiksa',
      );
    }
  } catch (error) {
    console.error(`sign-ui-manifest gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
