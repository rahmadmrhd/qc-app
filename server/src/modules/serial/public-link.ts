/**
 * Tautan bertanda tangan ke halaman publik laporan rusak (rancangan 2026-11-14 §4.8). Token tanpa keadaan di basis
 * data: `v1.<caseId>.<expSeconds>.<base64url(sig)>`; logika tanda tangan ada di `core/signed-link.ts` dengan label
 * kunci `qc:serial-report-link:v1` (terpisah dari kunci sesi dan dari tautan jenis lain).
 */
import { createLinkSigner } from '../../core/signed-link';

const signer = createLinkSigner('qc:serial-report-link:v1');

/**
 * Waktu kedaluwarsa (epoch ms, akhir detik terakhir yang masih sah) dari token yang SUDAH lolos `verifyReportToken`.
 * Dipakai halaman publik agar tanggal "berlaku sampai" selalu sama dengan yang dikandung token, bukan dihitung ulang.
 */
export function reportTokenExpiresAt(token: string): number {
  return Number(token.split('.')[2]) * 1000 + 999;
}

/** Membuat token untuk laporan `caseId` yang berlaku sampai `expiresAtMs` (disimpan dalam detik penuh, dibulatkan ke bawah). */
export function signReportToken(
  secret: string,
  caseId: string,
  expiresAtMs: number,
): Promise<string> {
  return signer.sign(secret, caseId, expiresAtMs);
}

/** `{ caseId }` bila token sah dan belum kedaluwarsa pada `nowMs`; selain itu `null`. */
export async function verifyReportToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<{ caseId: string } | null> {
  const verified = await signer.verify(secret, token, nowMs);
  return verified === null ? null : { caseId: verified.id };
}
