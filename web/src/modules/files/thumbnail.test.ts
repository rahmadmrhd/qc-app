import { GUIDE_LIMITS } from '@shared/stickers';
import { expect, test } from 'vitest';
import { pickThumbnail, thumbnailPlans } from './thumbnail';

test('thumbnailPlans mulai dari 320 px WebP dan berakhir di 160 px JPEG', () => {
  const plans = thumbnailPlans();
  expect(plans[0]).toEqual({ side: 320, mime: 'image/webp', quality: 0.8 });
  expect(plans.at(-1)).toEqual({ side: 160, mime: 'image/jpeg', quality: 0.4 });
  expect(plans).toHaveLength(3 * 2 * 3);
  expect(plans.some((plan) => plan.mime === 'image/jpeg')).toBe(true);
});

test('thumbnailPlans: urutan sisi menurun, tidak ada sisi di atas batas server', () => {
  const plans = thumbnailPlans();
  const sides = plans.map((plan) => plan.side);
  expect(sides).toEqual([...sides].sort((a, b) => b - a));
  expect(Math.max(...sides)).toBe(GUIDE_LIMITS.thumbSide);
  expect(plans.every((plan) => plan.side <= GUIDE_LIMITS.thumbMaxSide)).toBe(true);
});

const blobOf = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });

test('pickThumbnail memakai rencana pertama yang <= target dan bertipe sesuai', async () => {
  const tried: string[] = [];
  const result = await pickThumbnail(thumbnailPlans(), async (plan) => {
    tried.push(`${plan.side}/${plan.mime}/${plan.quality}`);
    return plan.quality <= 0.6
      ? blobOf(100, plan.mime)
      : blobOf(GUIDE_LIMITS.thumbTargetBytes + 1, plan.mime);
  });
  expect(tried).toEqual(['320/image/webp/0.8', '320/image/webp/0.6']);
  expect(result.mime).toBe('image/webp');
  expect(result.bytes).toHaveLength(100);
});

test('pickThumbnail melewati hasil yang tipenya jatuh balik (mis. PNG) dan null', async () => {
  const result = await pickThumbnail(thumbnailPlans(), async (plan) => {
    if (plan.mime === 'image/webp') return blobOf(10, 'image/png');
    return plan.quality === 0.8 ? null : blobOf(10, 'image/jpeg');
  });
  expect(result.mime).toBe('image/jpeg');
});

test('pickThumbnail menerima tepat target, menolak satu byte lebih', async () => {
  const exact = await pickThumbnail(thumbnailPlans(), async (plan) =>
    blobOf(GUIDE_LIMITS.thumbTargetBytes, plan.mime),
  );
  expect(exact.bytes).toHaveLength(GUIDE_LIMITS.thumbTargetBytes);
  await expect(
    pickThumbnail(thumbnailPlans(), async (plan) =>
      blobOf(GUIDE_LIMITS.thumbTargetBytes + 1, plan.mime),
    ),
  ).rejects.toThrow('Thumbnail gagal dibuat');
});
