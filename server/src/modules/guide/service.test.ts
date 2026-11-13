import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { GuideId } from '@shared/guides';
import { listGuides, markGuide } from './service';

setDefaultTimeout(60_000);

let env: TestEnv;
const user = { email: 'Pengguna@Gmail.com' };

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-13T03:00:00.000Z'));
});

describe('markGuide dengan cakupan', () => {
  test('menulis panduan dan panduan yang dicakupnya sekaligus', async () => {
    const covers = { 'handover-dasar': ['tip-handover-tempel-wa'] } as const;
    const result = await markGuide(env, user, { id: 'handover-dasar', version: 1 }, covers);
    expect(result).toEqual([
      { id: 'handover-dasar', version: 1 },
      { id: 'tip-handover-tempel-wa', version: 1 },
    ]);
    expect(await listGuides(env, user)).toEqual(result);
  });

  test('atomik: bila satu baris gagal, tak ada baris tertulis', async () => {
    // Id melebihi VARCHAR(100) membuat INSERT kedua gagal; seluruh batch harus dibatalkan.
    const bogus = 'x'.repeat(300) as GuideId;
    const covers = { 'handover-dasar': ['tip-handover-tempel-wa', bogus] } as const;
    await expect(
      markGuide(env, user, { id: 'handover-dasar', version: 1 }, covers),
    ).rejects.toBeDefined();
    expect(await listGuides(env, user)).toEqual([]);
  });

  test('cakupan tidak menurunkan versi panduan yang sudah lebih tinggi', async () => {
    await env.DB.prepare(
      'INSERT INTO guide_progress (recipient, guide_id, `version`, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind('pengguna@gmail.com', 'tip-handover-tempel-wa', 4, 'x')
      .run();
    const covers = { 'handover-dasar': ['tip-handover-tempel-wa'] } as const;
    const result = await markGuide(env, user, { id: 'handover-dasar', version: 1 }, covers);
    expect(result.find((row) => row.id === 'tip-handover-tempel-wa')?.version).toBe(4);
  });
});
