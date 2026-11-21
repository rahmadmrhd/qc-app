import { describe, expect, test } from 'bun:test';
import { isUlid, ulidTime } from '@shared/ids';
import { newId } from './id';

describe('newId', () => {
  test('menghasilkan ULID huruf kecil yang sah dengan waktu sekarang', () => {
    const before = Date.now();
    const id = newId();
    expect(isUlid(id)).toBe(true);
    const time = ulidTime(id) as number;
    expect(time).toBeGreaterThanOrEqual(before - 1);
    expect(time).toBeLessThanOrEqual(Date.now() + 1);
  });

  test('puluhan ribu ID berturut-turut unik dan terurut menaik', () => {
    const ids = Array.from({ length: 50_000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      if ((ids[i - 1] as string) >= (ids[i] as string)) throw new Error(`tidak menaik di ${i}`);
    }
  });
});
