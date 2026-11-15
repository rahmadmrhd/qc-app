import { normalizePublicKeyInput, publicKeyFingerprint } from '../../countrylock/src/ui-manifest';

export interface ResolvedUiPublicKey {
  /** PEM SPKI baku yang disuntikkan ke bundel, atau `null` (pembaruan UI nonaktif). */
  pem: string | null;
  /** Sidik SHA-256 (bukan rahasia) untuk dicetak di log build; `null` bila tanpa kunci. */
  fingerprint: string | null;
}

/**
 * Membaca `UI_PUBLIC_KEY_PEM` dari env build dan memvalidasinya (PEM, PEM dengan `\n` harfiah, atau base64 satu baris;
 * harus kunci publik Ed25519). Env kosong = `null`, kecuali `required` (build rilis): itu galat, karena aplikasi tanpa
 * kunci diam-diam kehilangan pembaruan UI. Kunci yang diberikan tetapi rusak SELALU galat. Isi nilai tak pernah masuk
 * pesan galat.
 */
export function resolveUiPublicKey(
  env: Record<string, string | undefined>,
  required = false,
): ResolvedUiPublicKey {
  const raw = env.UI_PUBLIC_KEY_PEM?.trim();
  if (!raw) {
    if (required) {
      throw new Error(
        'UI_PUBLIC_KEY_PEM kosong: build rilis desktop wajib menanam kunci publik tanda tangan UI (docs/desktop-ui-signing.md)',
      );
    }
    return { pem: null, fingerprint: null };
  }
  const pem = normalizePublicKeyInput(raw);
  if (!pem)
    throw new Error('UI_PUBLIC_KEY_PEM bukan kunci publik yang dapat dibaca (PEM atau base64)');
  try {
    return { pem, fingerprint: publicKeyFingerprint(pem) };
  } catch {
    throw new Error('UI_PUBLIC_KEY_PEM bukan kunci publik Ed25519 yang sah');
  }
}
