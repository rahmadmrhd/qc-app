import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  normalizePublicKeyInput,
  publicKeyFingerprint,
  publicKeyPemOf,
  signUiManifest,
  UI_MANIFEST_FILE,
  UI_MANIFEST_SIGNATURE_FILE,
  verifyUiManifest,
} from '../countrylock/src/ui-manifest';
import { checkUiKey } from './check-ui-key';
import { WEB_DIST_DIR } from './paths';

export interface SignOptions {
  /**
   * Kunci publik desktop (`UI_PUBLIC_KEY_PEM`: PEM, atau base64 satu baris). Bila diberikan, tanda tangan HARUS lolos
   * dengan kunci ini; tidak lolos = GAGAL sebelum `.sig` ditulis (desktop akan menolak setiap pembaruan UI).
   */
  publicKey?: string;
  /** Kunci publik wajib ada (build image rilis): kosong = galat, bukan peringatan. */
  requirePublicKey?: boolean;
}

/**
 * Menandatangani `ui-manifest.json` di `distDir` dengan kunci privat Ed25519 (PEM PKCS8) dari BERKAS `keyFile`
 * dan menulis `ui-manifest.sig` (base64url). Kunci tak pernah masuk pesan galat atau log. Mengembalikan tanda tangan.
 * Dengan `options.publicKey` kecocokan privat↔publik diperiksa langsung (padanan manual: `scripts/check-ui-key.ts`).
 */
export function signDistManifest(
  distDir: string,
  keyFile: string,
  options: SignOptions = {},
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
  if (options.publicKey?.trim()) {
    const publicPem = normalizePublicKeyInput(options.publicKey);
    if (!publicPem)
      throw new Error('UI_PUBLIC_KEY_PEM bukan kunci publik yang dapat dibaca (PEM atau base64)');
    // Pasangan privat↔publik (uji tanda tangan sungguhan + sidik), lalu tanda tangan manifest ini sendiri.
    checkUiKey({ privateKeyFile: keyFile, publicKeyPem: publicPem });
    if (!verifyUiManifest(json, signature, publicPem)) {
      throw new Error(
        'Tanda tangan manifest tidak lolos dengan kunci publik desktop (UI_PUBLIC_KEY_PEM)',
      );
    }
  } else if (options.requirePublicKey) {
    throw new Error(
      'UI_PUBLIC_KEY_PEM wajib diberikan saat menandatangani (build-arg Dockerfile): tanpa itu kecocokan dengan kunci publik desktop tak dapat diperiksa',
    );
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
    const publicKey = process.env.UI_PUBLIC_KEY_PEM;
    signDistManifest(distDir, keyFile, {
      publicKey,
      requirePublicKey: process.argv.includes('--require-public-key'),
    });
    console.log('sign-ui-manifest OK (ui-manifest.sig ditulis)');
    // Sidik kunci publik (bukan rahasia) dicetak agar mudah dibaca di log CI.
    console.log(
      `  sidik kunci publik penandatangan: ${publicKeyFingerprint(publicKeyPemOf(readFileSync(keyFile, 'utf8')))}`,
    );
    if (!publicKey?.trim()) {
      console.warn(
        'sign-ui-manifest peringatan: UI_PUBLIC_KEY_PEM tidak diberikan; kecocokan dengan kunci publik desktop TIDAK diperiksa',
      );
    }
  } catch (error) {
    console.error(`sign-ui-manifest gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
