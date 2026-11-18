import { normalizePublicKeyInput, publicKeyFingerprint } from '../../countrylock/src/ui-manifest';

export interface ResolvedUiPublicKey {
  /** PEM SPKI baku yang disuntikkan ke bundel, atau `null` (pembaruan nonaktif). */
  pem: string | null;
  /** Sidik SHA-256 (bukan rahasia) untuk dicetak di log build; `null` bila tanpa kunci. */
  fingerprint: string | null;
}

interface PublicKeySpec {
  /** Nama env build yang memuat kunci. */
  envName: string;
  /** Kalimat galat bila kunci wajib tetapi kosong (tanpa isi kunci). */
  requiredMessage: string;
}

/**
 * Membaca kunci publik dari env build dan memvalidasinya (PEM, PEM dengan `\n` harfiah, atau base64 satu baris; harus
 * kunci publik Ed25519). Env kosong = `null`, kecuali `required` (build rilis): itu galat, karena aplikasi tanpa kunci
 * diam-diam kehilangan pembaruan. Kunci yang diberikan tetapi rusak SELALU galat. Isi nilai tak pernah masuk pesan galat.
 */
function resolvePublicKey(
  env: Record<string, string | undefined>,
  spec: PublicKeySpec,
  required: boolean,
): ResolvedUiPublicKey {
  const raw = env[spec.envName]?.trim();
  if (!raw) {
    if (required) throw new Error(spec.requiredMessage);
    return { pem: null, fingerprint: null };
  }
  const pem = normalizePublicKeyInput(raw);
  if (!pem) {
    throw new Error(`${spec.envName} bukan kunci publik yang dapat dibaca (PEM atau base64)`);
  }
  try {
    return { pem, fingerprint: publicKeyFingerprint(pem) };
  } catch {
    throw new Error(`${spec.envName} bukan kunci publik Ed25519 yang sah`);
  }
}

/** Kunci publik tanda tangan manifest UI (`UI_PUBLIC_KEY_PEM`; docs/desktop-ui-signing.md). */
export function resolveUiPublicKey(
  env: Record<string, string | undefined>,
  required = false,
): ResolvedUiPublicKey {
  return resolvePublicKey(
    env,
    {
      envName: 'UI_PUBLIC_KEY_PEM',
      requiredMessage:
        'UI_PUBLIC_KEY_PEM kosong: build rilis desktop wajib menanam kunci publik tanda tangan UI (docs/desktop-ui-signing.md)',
    },
    required,
  );
}

/** Kunci publik tanda tangan manifest rilis aplikasi (`DESKTOP_RELEASE_PUBLIC_KEY_PEM`; docs/desktop-release-signing.md). */
export function resolveReleasePublicKey(
  env: Record<string, string | undefined>,
  required = false,
): ResolvedUiPublicKey {
  return resolvePublicKey(
    env,
    {
      envName: 'DESKTOP_RELEASE_PUBLIC_KEY_PEM',
      requiredMessage:
        'DESKTOP_RELEASE_PUBLIC_KEY_PEM kosong: build rilis desktop wajib menanam kunci publik tanda tangan rilis (docs/desktop-release-signing.md)',
    },
    required,
  );
}
