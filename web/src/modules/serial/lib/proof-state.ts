import type { SerialEventDto } from '@shared/contract';

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
