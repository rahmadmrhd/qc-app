import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

/** Berkas kunci privat wajib berakhiran ini agar tertangkap `.gitignore` (`*.ui-signing-key.pem`). */
const PRIVATE_KEY_SUFFIX = '.ui-signing-key.pem';

export interface GeneratedSigningKey {
  publicKeyPath: string;
  publicKeyPem: string;
}

/**
 * Membangkitkan pasangan kunci Ed25519 untuk menandatangani manifest UI. Kunci PRIVAT ditulis ke `privateKeyPath`
 * (izin 0600, tidak menimpa berkas yang ada) dan TIDAK dikembalikan atau dicetak; kunci publik (bukan rahasia,
 * ditanam di aplikasi desktop) ditulis ke `<nama>.pub.pem` di sebelahnya.
 */
export function generateSigningKey(privateKeyPath: string): GeneratedSigningKey {
  if (!privateKeyPath.endsWith(PRIVATE_KEY_SUFFIX)) {
    throw new Error(`Nama berkas kunci privat harus berakhiran ${PRIVATE_KEY_SUFFIX}`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const publicKeyPath = `${privateKeyPath.slice(0, -'.pem'.length)}.pub.pem`;
  // `wx`: gagal bila sudah ada (jangan menimpa kunci yang mungkin sedang dipakai).
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), {
    mode: 0o600,
    flag: 'wx',
  });
  writeFileSync(publicKeyPath, publicKeyPem, { flag: 'wx' });
  return { publicKeyPath, publicKeyPem };
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error(`Pemakaian: bun run scripts/gen-ui-signing-key.ts <jalur>${PRIVATE_KEY_SUFFIX}`);
    process.exit(1);
  }
  try {
    const { publicKeyPath, publicKeyPem } = generateSigningKey(out);
    console.log(`Kunci privat ditulis ke ${out} (TIDAK dicetak; jangan dikomit atau dibagikan).`);
    console.log(`Kunci publik ditulis ke ${publicKeyPath}; tanam di aplikasi desktop (H7):\n`);
    console.log(publicKeyPem);
    console.log(
      'Simpan kunci privat sebagai secret CI `ui_signing_key` (docs/ci-cd.md); catatan: di Windows izin 0600 tidak berlaku, simpan di folder pribadi.',
    );
  } catch (error) {
    console.error(`gen-ui-signing-key gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
