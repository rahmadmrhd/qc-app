/**
 * Token tautan dashboard publik: `v1.<shareId>.<expSeconds>.<sig>` dengan kunci turunan berlabel
 * `qc:dashboard-share-link:v1` dari `SESSION_SECRET`. Mengganti `SESSION_SECRET` mematikan semua tautan.
 */
import { createLinkSigner } from '../../core/signed-link';

const signer = createLinkSigner('qc:dashboard-share-link:v1');

/** Membuat token untuk tautan `shareId` yang berlaku sampai `expiresAtMs`. */
export function signShareToken(
  secret: string,
  shareId: string,
  expiresAtMs: number,
): Promise<string> {
  return signer.sign(secret, shareId, expiresAtMs);
}

/** `{ shareId }` bila token sah dan belum kedaluwarsa pada `nowMs`; selain itu `null`. */
export async function verifyShareToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<{ shareId: string } | null> {
  const verified = await signer.verify(secret, token, nowMs);
  return verified === null ? null : { shareId: verified.id };
}
