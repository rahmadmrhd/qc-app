import type { SerialEventDto, SerialProofPhotoDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { hasPendingProof, pagesHavePendingProof } from './proof-state';

const photo = (state: SerialProofPhotoDto['state']): SerialProofPhotoDto => ({
  id: `p-${state}`,
  state,
  mime: 'image/webp',
  size: 1,
  width: 1,
  height: 1,
  filename: 'bukti-x.webp',
  error: null,
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
