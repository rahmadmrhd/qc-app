import { publicKeyFingerprint, publicKeyOneLine } from '../countrylock/src/ui-manifest';
import { generateSigningKey, RELEASE_PRIVATE_KEY_SUFFIX } from './gen-ui-signing-key';

/**
 * Membangkitkan pasangan kunci Ed25519 untuk menandatangani rilis aplikasi desktop (`release-<versi>.json`). Terpisah
 * dari kunci manifest UI: bocornya satu tak mengizinkan memalsukan yang lain. Logikanya memakai ulang
 * `generateSigningKey` (kunci privat izin 0600, tak menimpa, tak dicetak) dengan sufiks `.release-signing-key.pem`.
 */
if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error(
      `Pemakaian: bun run scripts/gen-release-signing-key.ts <jalur>${RELEASE_PRIVATE_KEY_SUFFIX}`,
    );
    process.exit(1);
  }
  try {
    const { publicKeyPath, publicKeyPem } = generateSigningKey(out, RELEASE_PRIVATE_KEY_SUFFIX);
    console.log(`Kunci privat ditulis ke ${out} (TIDAK dicetak; jangan dikomit atau dibagikan).`);
    console.log(`Kunci publik ditulis ke ${publicKeyPath}:\n`);
    console.log(publicKeyPem);
    console.log(
      'Nilai DESKTOP_RELEASE_PUBLIC_KEY_PEM (satu baris; isi Variable GitHub dan env build desktop dengan ini, bukan secret):\n',
    );
    console.log(publicKeyOneLine(publicKeyPem));
    console.log(`\nSidik SHA-256 kunci publik: ${publicKeyFingerprint(publicKeyPem)}\n`);
    console.log(
      'Simpan kunci privat sebagai secret GitHub DESKTOP_RELEASE_SIGNING_KEY di environment desktop-release (docs/desktop-release-signing.md); di Windows izin 0600 tidak berlaku, simpan di folder pribadi.',
    );
  } catch (error) {
    console.error(
      `gen-release-signing-key gagal: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
