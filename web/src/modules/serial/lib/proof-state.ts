import type { SerialEventDto, SerialProofPhotoDto } from '@shared/contract';

/** Selang segar ulang riwayat selama ada foto bukti yang menunggu cap. */
export const PROOF_POLL_MS = 5000;

/** Ada foto bukti yang masih antre atau diproses (belum selesai maupun gagal). */
export function hasPendingProof(events: readonly SerialEventDto[]): boolean {
  return events.some((event) =>
    event.proofPhotos.some((photo) => photo.state === 'queued' || photo.state === 'processing'),
  );
}

export function pagesHavePendingProof(
  pages: readonly { events: readonly SerialEventDto[] }[],
): boolean {
  return pages.some((page) => hasPendingProof(page.events));
}

/**
 * Batas buang otomatis TERDEKAT di antara foto `failed` (ISO UTC), atau `null` bila tak ada yang membawa `expiresAt`.
 * ISO UTC dari server seragam, jadi urutan teks = urutan waktu.
 */
export function earliestProofExpiry(photos: readonly SerialProofPhotoDto[]): string | null {
  const all = photos.flatMap((photo) => (photo.expiresAt ? [photo.expiresAt] : []));
  return all.length === 0 ? null : all.reduce((min, value) => (value < min ? value : min));
}
