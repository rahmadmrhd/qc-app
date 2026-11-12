import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
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
 */
export function signDistManifest(distDir: string, keyFile: string): string {
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
    signDistManifest(distDir, keyFile);
    console.log('sign-ui-manifest OK (ui-manifest.sig ditulis)');
  } catch (error) {
    console.error(`sign-ui-manifest gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
