import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { publicKeyFingerprint, publicKeyOneLine } from '../countrylock/src/ui-manifest';

/** Berkas kunci privat wajib berakhiran ini agar tertangkap `.gitignore` (`*.ui-signing-key.pem`). */
const PRIVATE_KEY_SUFFIX = '.ui-signing-key.pem';
/** Kunci penandatangan rilis desktop memakai generator yang sama dengan sufiks sendiri (`gen-release-signing-key.ts`). */
export const RELEASE_PRIVATE_KEY_SUFFIX = '.release-signing-key.pem';

export interface GeneratedSigningKey {
  publicKeyPath: string;
  publicKeyPem: string;
}

/**
 * Membangkitkan pasangan kunci Ed25519 untuk menandatangani manifest UI. Kunci PRIVAT ditulis ke `privateKeyPath`
 * (izin 0600, tidak menimpa berkas yang ada) dan TIDAK dikembalikan atau dicetak; kunci publik (bukan rahasia,
 * ditanam di aplikasi desktop) ditulis ke `<nama>.pub.pem` di sebelahnya.
 */
export function generateSigningKey(
  privateKeyPath: string,
  suffix: string = PRIVATE_KEY_SUFFIX,
): GeneratedSigningKey {
  if (!privateKeyPath.endsWith(suffix)) {
    throw new Error(`Nama berkas kunci privat harus berakhiran ${suffix}`);
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
    console.log(`Kunci publik ditulis ke ${publicKeyPath}:\n`);
    console.log(publicKeyPem);
    console.log(
      'Nilai UI_PUBLIC_KEY_PEM (satu baris; isi Variable GitHub dan env build desktop dengan ini, bukan secret):\n',
    );
    console.log(publicKeyOneLine(publicKeyPem));
    console.log(
      `\nSidik SHA-256 kunci publik (untuk dibandingkan di log build): ${publicKeyFingerprint(publicKeyPem)}\n`,
    );
    console.log(
      'Simpan kunci privat sebagai secret GitHub UI_SIGNING_KEY (docs/desktop-ui-signing.md); catatan: di Windows izin 0600 tidak berlaku, simpan di folder pribadi.',
    );
  } catch (error) {
    console.error(`gen-ui-signing-key gagal: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
