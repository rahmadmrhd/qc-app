import { readFileSync, statSync } from 'node:fs';
import {
  normalizeFingerprint,
  normalizePublicKeyInput,
  publicKeyFingerprint,
  publicKeyPemOf,
  signUiManifest,
  verifyUiManifest,
} from '../countrylock/src/ui-manifest';

export interface CheckUiKeyOptions {
  /** Jalur berkas kunci privat PEM PKCS8 (hanya dibaca, isinya tak pernah dicetak). */
  privateKeyFile?: string;
  /**
   * Kunci publik desktop (`UI_PUBLIC_KEY_PEM`): PEM, PEM dengan `\n` harfiah, atau base64 satu baris; kosong/`null` =
   * belum ditanam (pembaruan UI desktop nonaktif).
   */
  publicKeyPem?: string | null;
  /** Sidik yang diharapkan (SHA-256 SPKI, heksa; `:` dan huruf besar diterima). */
  expectedFingerprint?: string;
  /** Kunci publik wajib ada (build desktop rilis); tanpa ini `null` hanya diberi peringatan. */
  requirePublicKey?: boolean;
}

export interface CheckUiKeyResult {
  publicFingerprint: string | null;
  privateFingerprint: string | null;
  /** Pesan non-fatal untuk dicetak (mis. kunci publik belum ditanam). */
  warnings: string[];
}

function readPrivateKey(file: string): string {
  try {
    if (!statSync(file).isFile()) throw new Error('bukan berkas');
    return readFileSync(file, 'utf8');
  } catch {
    // Jalur boleh disebut; isi kunci tak pernah.
    throw new Error(`Berkas kunci privat tidak terbaca: ${file}`);
  }
}

/**
 * Memeriksa kecocokan kunci penandatangan (privat, di CI) dengan kunci publik yang tertanam di desktop. Semua galat
 * bersifat generik: isi kunci tak pernah masuk pesan. Melempar `Error` pada kegagalan pertama.
 */
export function checkUiKey(options: CheckUiKeyOptions): CheckUiKeyResult {
  const warnings: string[] = [];
  const rawPublic = options.publicKeyPem?.trim() ? options.publicKeyPem : null;
  if (rawPublic === null && options.requirePublicKey) {
    throw new Error('Kunci publik desktop kosong (UI_PUBLIC_KEY_PEM): pembaruan UI akan nonaktif');
  }
  const publicPem = rawPublic === null ? null : normalizePublicKeyInput(rawPublic);
  if (rawPublic !== null && publicPem === null) {
    throw new Error('Kunci publik desktop tidak sah (butuh PEM SPKI Ed25519)');
  }

  let publicFingerprint: string | null = null;
  if (publicPem) {
    try {
      publicFingerprint = publicKeyFingerprint(publicPem);
    } catch {
      throw new Error('Kunci publik desktop tidak sah (butuh PEM SPKI Ed25519)');
    }
  } else {
    warnings.push('Kunci publik desktop belum ditanam: pembaruan UI desktop nonaktif.');
  }

  let privateFingerprint: string | null = null;
  if (options.privateKeyFile) {
    const privatePem = readPrivateKey(options.privateKeyFile);
    let derivedPublicPem: string;
    try {
      derivedPublicPem = publicKeyPemOf(privatePem);
      privateFingerprint = publicKeyFingerprint(derivedPublicPem);
      // Uji penandatanganan sungguhan: kunci privat harus benar-benar dapat menghasilkan tanda tangan sah.
      const sample = JSON.stringify({ uji: 'check-ui-key' });
      if (!verifyUiManifest(sample, signUiManifest(sample, privatePem), derivedPublicPem)) {
        throw new Error('x');
      }
    } catch {
      throw new Error('Kunci privat tidak sah (butuh PEM PKCS8 Ed25519)');
    }
    if (publicPem) {
      // Uji silang: tanda tangan kunci privat harus lolos dengan kunci publik yang tertanam di desktop.
      const sample = JSON.stringify({ uji: 'pasangan-kunci' });
      const signature = signUiManifest(sample, privatePem);
      if (
        !verifyUiManifest(sample, signature, publicPem) ||
        privateFingerprint !== publicFingerprint
      ) {
        throw new Error(
          'Kunci privat (CI) dan kunci publik (desktop) TIDAK berpasangan: desktop akan menolak setiap pembaruan UI',
        );
      }
    }
  }

  if (options.expectedFingerprint?.trim()) {
    const expected = normalizeFingerprint(options.expectedFingerprint);
    if (!expected) throw new Error('Sidik yang diharapkan bukan SHA-256 heksa 64 karakter');
    for (const [label, actual] of [
      ['kunci publik desktop', publicFingerprint],
      ['kunci privat', privateFingerprint],
    ] as const) {
      if (actual !== null && actual !== expected) {
        throw new Error(`Sidik ${label} tidak sama dengan sidik yang diharapkan`);
      }
    }
    if (publicFingerprint === null && privateFingerprint === null) {
      throw new Error('Sidik yang diharapkan diberikan tetapi tidak ada kunci untuk dibandingkan');
    }
  }

  if (publicFingerprint === null && privateFingerprint === null) {
    throw new Error('Tidak ada kunci untuk diperiksa (berikan --private dan/atau kunci publik)');
  }
  return { publicFingerprint, privateFingerprint, warnings };
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  try {
    // Kunci publik: `--public <berkas>` atau env UI_PUBLIC_KEY_PEM (nilai yang sama dengan Variable CI).
    const publicFile = flag('--public');
    const publicKeyPem = publicFile
      ? readFileSync(publicFile, 'utf8')
      : process.env.UI_PUBLIC_KEY_PEM;
    const result = checkUiKey({
      privateKeyFile: flag('--private') ?? process.env.UI_SIGNING_KEY_FILE,
      publicKeyPem,
      expectedFingerprint: flag('--expect'),
      requirePublicKey: process.argv.includes('--require-public'),
    });
    for (const warning of result.warnings) console.warn(`check-ui-key peringatan: ${warning}`);
    console.log('check-ui-key OK');
    if (result.publicFingerprint)
      console.log(`  sidik kunci publik desktop : ${result.publicFingerprint}`);
    if (result.privateFingerprint)
      console.log(`  sidik dari kunci privat    : ${result.privateFingerprint}`);
  } catch (error) {
    console.error(`check-ui-key GAGAL: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
