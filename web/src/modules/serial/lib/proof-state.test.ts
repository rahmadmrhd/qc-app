import type { SerialEventDto, SerialProofPhotoDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  earliestProofExpiry,
  failedProofPhotos,
  hasPendingProof,
  pagesHavePendingProof,
} from './proof-state';

const photo = (state: SerialProofPhotoDto['state']): SerialProofPhotoDto => ({
  id: `p-${state}`,
  state,
  mime: 'image/webp',
  size: 1,
  width: 1,
  height: 1,
  filename: 'bukti-x.webp',
  error: null,
  canManage: true,
  canRetry: true,
  failedAt: null,
  expiresAt: null,
});
const event = (...states: SerialProofPhotoDto['state'][]) =>
  ({ proofPhotos: states.map(photo) }) as SerialEventDto;

test('antre atau diproses = menunggu; selesai, gagal, atau tanpa foto = tidak', () => {
  expect(hasPendingProof([event('queued')])).toBe(true);
  expect(hasPendingProof([event('done'), event('processing')])).toBe(true);
  expect(hasPendingProof([event('done', 'failed'), event()])).toBe(false);
  expect(hasPendingProof([])).toBe(false);
});

test('pagesHavePendingProof memeriksa semua halaman', () => {
  expect(pagesHavePendingProof([{ events: [event('done')] }, { events: [event('queued')] }])).toBe(
    true,
  );
  expect(pagesHavePendingProof([{ events: [event('done')] }])).toBe(false);
  expect(pagesHavePendingProof([])).toBe(false);
});

test('failedProofPhotos mengumpulkan hanya foto gagal dari semua kejadian', () => {
  const failedA = { ...photo('failed'), id: 'fa' };
  const failedB = { ...photo('failed'), id: 'fb' };
  const events = [
    { proofPhotos: [photo('done'), failedA] },
    { proofPhotos: [] },
    { proofPhotos: [failedB, photo('queued')] },
  ] as SerialEventDto[];
  expect(failedProofPhotos(events).map((p) => p.id)).toEqual(['fa', 'fb']);
  expect(failedProofPhotos([])).toEqual([]);
});

test('earliestProofExpiry memilih batas terdekat dan null bila tak ada', () => {
  const a = { ...photo('failed'), expiresAt: '2026-12-05T03:00:00.000Z' };
  const b = { ...photo('failed'), expiresAt: '2026-12-01T03:00:00.000Z' };
  expect(earliestProofExpiry([a, b])).toBe('2026-12-01T03:00:00.000Z');
  expect(earliestProofExpiry([photo('failed')])).toBeNull();
  expect(earliestProofExpiry([])).toBeNull();
});
